/**
 * CommandServer — HTTP + WebSocket server for the DevTools panel extension.
 *
 * Endpoints:
 *   POST /run              Panel commands → engine.run()
 *   GET  /json/version     CDP discovery (webSocketDebuggerUrl)
 *   WS   /extension        background.js connects here
 *   WS   /devtools/browser/* Playwright connects via connectOverCDP
 *
 * CDP relay logic copied from Playwright's CDPRelayServer
 * (playwright/lib/mcp/extension/cdpRelay.js).
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { parseInput } from './parser.mjs';
import {
  buildRunCode, verifyText, verifyElement, verifyValue, verifyList,
  actionByText, fillByText, selectByText, checkByText, uncheckByText,
} from './page-scripts.mjs';

// ─── CommandServer ──────────────────────────────────────────────────────────

export class CommandServer {
  constructor(engine) {
    this._engine = engine;
    this._server = null;
    this._port = null;

    // CDP relay state (matches CDPRelayServer)
    this._playwrightConnection = null;
    this._extensionConnection = null;
    this._connectedTabInfo = undefined;
    this._nextSessionId = 1;

    // WebSocket paths
    const uuid = randomUUID();
    this._cdpPath = `/devtools/browser/${uuid}`;
    this._extensionPath = '/extension';

    // Extension connection promise
    this._resetExtensionConnection();
  }

  get port() { return this._port; }
  get cdpPath() { return this._cdpPath; }

  async start(port = 3000) {
    this._port = port;
    this._server = createServer((req, res) => this._handleHttp(req, res));

    // WebSocket server
    this._wss = new WebSocketServer({ server: this._server });
    this._wss.on('connection', (ws, req) => this._onConnection(ws, req));

    return new Promise((resolve, reject) => {
      this._server.listen(port, () => resolve());
      this._server.on('error', reject);
    });
  }

  /**
   * Wait for the extension's background.js to connect via WebSocket.
   */
  async waitForExtension() {
    if (this._extensionConnection) return;
    await this._extensionConnectionPromise;
  }

  async close() {
    this._closeConnections('Server stopped');
    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }
    if (this._server) {
      await new Promise((resolve) => this._server.close(resolve));
      this._server = null;
    }
  }

  // ─── HTTP handler ───────────────────────────────────────────────────────

  async _handleHttp(req, res) {
    // CORS — allow chrome-extension:// origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlPath = req.url.replace(/\/+$/, '');

    // Relay info endpoint — background.js uses this to discover the CDPRelayServer WS URL.
    if (req.method === 'GET' && urlPath === '/relay-info') {
      if (!this.relay) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Relay not ready' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ extensionEndpoint: this.relay.extensionEndpoint() }));
      return;
    }

    // CDP discovery endpoint
    if (req.method === 'GET' && urlPath === '/json/version') {
      const wsUrl = `ws://127.0.0.1:${this._port}${this._cdpPath}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        'Browser': 'Chrome/Extension-Bridge',
        'Protocol-Version': '1.3',
        'User-Agent': 'CDP-Bridge-Server/1.0.0',
        'webSocketDebuggerUrl': wsUrl,
      }));
      return;
    }

    // Panel command endpoint
    if (req.method === 'POST' && req.url === '/run') {
      try {
        const body = await readBody(req);
        const { raw } = JSON.parse(body);
        let args = parseInput(raw);
        if (!args) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: `Unknown command: ${raw}`, isError: true }));
          return;
        }
        args = resolveArgs(args);
        const result = await this._engine.run(args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: e.message, isError: true }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  // ─── WebSocket connection routing ───────────────────────────────────────

  _onConnection(ws, req) {
    const url = new URL(`http://localhost${req.url}`);
    debugLog(`New connection to ${url.pathname}`);

    if (url.pathname === this._cdpPath) {
      this._handlePlaywrightConnection(ws);
    } else if (url.pathname === this._extensionPath) {
      this._handleExtensionConnection(ws);
    } else {
      debugLog(`Invalid path: ${url.pathname}`);
      ws.close(4004, 'Invalid path');
    }
  }

  // ─── Playwright connection ──────────────────────────────────────────────

  _handlePlaywrightConnection(ws) {
    if (this._playwrightConnection) {
      debugLog('Rejecting second Playwright connection');
      ws.close(1000, 'Another CDP client already connected');
      return;
    }

    this._playwrightConnection = ws;

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this._handlePlaywrightMessage(message);
      } catch (error) {
        debugLog(`Error while handling Playwright message\n${data.toString()}\n`, error);
      }
    });

    ws.on('close', () => {
      if (this._playwrightConnection !== ws) return;
      this._playwrightConnection = null;
      this._closeExtensionConnection('Playwright client disconnected');
      debugLog('Playwright WebSocket closed');
    });

    ws.on('error', (error) => {
      debugLog('Playwright WebSocket error:', error);
    });

    debugLog('Playwright MCP connected');
  }

  async _handlePlaywrightMessage(message) {
    debugLog('← Playwright:', `${message.method} (id=${message.id})`);
    const { id, sessionId, method, params } = message;
    try {
      const result = await this._handleCDPCommand(method, params, sessionId);
      this._sendToPlaywright({ id, sessionId, result });
    } catch (e) {
      debugLog('Error in the extension:', e);
      this._sendToPlaywright({
        id,
        sessionId,
        error: { message: e.message },
      });
    }
  }

  async _handleCDPCommand(method, params, sessionId) {
    switch (method) {
      case 'Browser.getVersion': {
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          userAgent: 'CDP-Bridge-Server/1.0.0',
        };
      }
      case 'Browser.setDownloadBehavior': {
        return {};
      }
      case 'Target.setAutoAttach': {
        if (sessionId) break;
        const { targetInfo } = await this._extensionConnection.send('attachToTab', {});
        this._connectedTabInfo = {
          targetInfo,
          sessionId: `pw-tab-${this._nextSessionId++}`,
        };
        debugLog('Simulating auto-attach');
        this._sendToPlaywright({
          method: 'Target.attachedToTarget',
          params: {
            sessionId: this._connectedTabInfo.sessionId,
            targetInfo: {
              ...this._connectedTabInfo.targetInfo,
              attached: true,
            },
            waitingForDebugger: false,
          },
        });
        return {};
      }
      case 'Target.getTargetInfo': {
        return this._connectedTabInfo?.targetInfo;
      }
    }
    return await this._forwardToExtension(method, params, sessionId);
  }

  async _forwardToExtension(method, params, sessionId) {
    if (!this._extensionConnection)
      throw new Error('Extension not connected');
    if (this._connectedTabInfo?.sessionId === sessionId)
      sessionId = undefined;
    return await this._extensionConnection.send('forwardCDPCommand', { sessionId, method, params });
  }

  _sendToPlaywright(message) {
    debugLog('→ Playwright:', `${message.method ?? `response(id=${message.id})`}`);
    this._playwrightConnection?.send(JSON.stringify(message));
  }

  // ─── Extension connection ───────────────────────────────────────────────

  _handleExtensionConnection(ws) {
    if (this._extensionConnection) {
      ws.close(1000, 'Another extension connection already established');
      return;
    }

    this._extensionConnection = new ExtensionConnection(ws);

    this._extensionConnection.onclose = (c, reason) => {
      debugLog('Extension WebSocket closed:', reason, c === this._extensionConnection);
      if (this._extensionConnection !== c) return;
      this._resetExtensionConnection();
      this._closePlaywrightConnection(`Extension disconnected: ${reason}`);
    };

    this._extensionConnection.onmessage = (method, params) => {
      this._handleExtensionMessage(method, params);
    };

    this._extensionConnectionResolve?.();
    debugLog('Extension connected');
  }

  _handleExtensionMessage(method, params) {
    switch (method) {
      case 'forwardCDPEvent': {
        const sessionId = params.sessionId || this._connectedTabInfo?.sessionId;
        this._sendToPlaywright({
          sessionId,
          method: params.method,
          params: params.params,
        });
        break;
      }
    }
  }

  // ─── Connection lifecycle ───────────────────────────────────────────────

  _closeConnections(reason) {
    this._closePlaywrightConnection(reason);
    this._closeExtensionConnection(reason);
  }

  _closeExtensionConnection(reason) {
    this._extensionConnection?.close(reason);
    this._extensionConnectionReject?.(new Error(reason));
    this._resetExtensionConnection();
  }

  _resetExtensionConnection() {
    this._connectedTabInfo = undefined;
    this._extensionConnection = null;
    this._extensionConnectionPromise = new Promise((resolve, reject) => {
      this._extensionConnectionResolve = resolve;
      this._extensionConnectionReject = reject;
    });
    // Prevent unhandled rejection
    this._extensionConnectionPromise.catch(() => {});
  }

  _closePlaywrightConnection(reason) {
    if (this._playwrightConnection?.readyState === WebSocket.OPEN)
      this._playwrightConnection.close(1000, reason);
    this._playwrightConnection = null;
  }
}

// ─── ExtensionConnection (matches CDPRelayServer's inner class) ──────────

class ExtensionConnection {
  constructor(ws) {
    this._callbacks = new Map();
    this._lastId = 0;
    this._ws = ws;
    this._ws.on('message', (data) => this._onMessage(data));
    this._ws.on('close', (code, reason) => this._onClose(code, reason));
    this._ws.on('error', (error) => this._onError(error));
  }

  async send(method, params) {
    if (this._ws.readyState !== WebSocket.OPEN)
      throw new Error(`Unexpected WebSocket state: ${this._ws.readyState}`);
    const id = ++this._lastId;
    this._ws.send(JSON.stringify({ id, method, params }));
    const error = new Error(`Protocol error: ${method}`);
    return new Promise((resolve, reject) => {
      this._callbacks.set(id, { resolve, reject, error });
    });
  }

  close(message) {
    debugLog('closing extension connection:', message);
    if (this._ws.readyState === WebSocket.OPEN)
      this._ws.close(1000, message);
  }

  _onMessage(data) {
    const eventData = data.toString();
    let parsedJson;
    try {
      parsedJson = JSON.parse(eventData);
    } catch (e) {
      debugLog(`<closing ws> Closing websocket due to malformed JSON. eventData=${eventData} e=${e?.message}`);
      this._ws.close();
      return;
    }
    try {
      this._handleParsedMessage(parsedJson);
    } catch (e) {
      debugLog(`<closing ws> Closing websocket due to failed onmessage callback. eventData=${eventData} e=${e?.message}`);
      this._ws.close();
    }
  }

  _handleParsedMessage(object) {
    if (object.id && this._callbacks.has(object.id)) {
      const callback = this._callbacks.get(object.id);
      this._callbacks.delete(object.id);
      if (object.error) {
        const error = callback.error;
        error.message = object.error;
        callback.reject(error);
      } else {
        callback.resolve(object.result);
      }
    } else if (object.id) {
      debugLog('← Extension: unexpected response', object);
    } else {
      this.onmessage?.(object.method, object.params);
    }
  }

  _onClose(code, reason) {
    debugLog(`<ws closed> code=${code} reason=${reason}`);
    this._dispose();
    this.onclose?.(this, reason?.toString() || '');
  }

  _onError(error) {
    debugLog(`<ws error> message=${error.message}`);
    this._dispose();
  }

  _dispose() {
    for (const callback of this._callbacks.values())
      callback.reject(new Error('WebSocket closed'));
    this._callbacks.clear();
  }
}

// ─── REPL-level argument transformations ────────────────────────────────────

/**
 * Apply the same transformations the CLI REPL does before engine.run():
 *   - Verify commands → run-code with page scripts
 *   - Text locators → run-code with actionByText/fillByText/etc.
 *   - Auto-wrap run-code body with async (page) => { ... }
 */
function resolveArgs(args) {
  const cmdName = args._[0];

  // ── Verify commands → run-code translation ──────────────────
  const verifyFns = {
    'verify-text': verifyText,
    'verify-element': verifyElement,
    'verify-value': verifyValue,
    'verify-list': verifyList,
  };
  if (verifyFns[cmdName]) {
    const pos = args._.slice(1);
    const fn = verifyFns[cmdName];
    let translated = null;
    if (cmdName === 'verify-text') {
      const text = pos.join(' ');
      if (text) translated = buildRunCode(fn, text);
    } else if (pos[0] && pos.length >= 2) {
      const rest = cmdName === 'verify-list' ? pos.slice(1) : pos.slice(1).join(' ');
      translated = buildRunCode(fn, pos[0], rest);
    }
    if (translated) args = translated;
  }

  // ── Auto-resolve text to native Playwright locator ─────────
  const textFns = {
    click: actionByText, dblclick: actionByText, hover: actionByText,
    fill: fillByText, select: selectByText, check: checkByText, uncheck: uncheckByText,
  };
  if (textFns[cmdName] && args._[1] && !/^e\d+$/.test(args._[1])) {
    const textArg = args._[1];
    const extraArgs = args._.slice(2);
    const fn = textFns[cmdName];
    if (fn === actionByText) args = buildRunCode(fn, textArg, cmdName);
    else if (cmdName === 'fill' || cmdName === 'select') args = buildRunCode(fn, textArg, extraArgs[0] || '');
    else args = buildRunCode(fn, textArg);
  }

  // ── Auto-wrap run-code body with async (page) => { ... } ──
  if (cmdName === 'run-code' && args._[1] && !args._[1].startsWith('async')) {
    const STMT = /^(await|return|const|let|var|for|if|while|throw|try)\b/;
    const body = !args._[1].includes(';') && !STMT.test(args._[1])
      ? `return await ${args._[1]}`
      : args._[1];
    args = { _: ['run-code', `async (page) => { ${body} }`] };
  }

  return args;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => data += chunk);
    req.on('end', () => resolve(data));
  });
}

function debugLog(...args) {
  console.log('[relay]', ...args);
}
