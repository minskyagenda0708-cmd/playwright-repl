/**
 * RelayConnection — CDP relay over WebSocket.
 *
 * Copied from Playwright MCP Bridge (packages/extension/src/relayConnection.ts),
 * converted to plain JS. Bridges chrome.debugger <-> WebSocket so Playwright
 * can control a browser tab via connectOverCDP.
 *
 * Protocol (3 message types):
 *   Server -> Extension:
 *     { id, method: "attachToTab", params: {} }
 *       -> attach chrome.debugger, return targetInfo
 *     { id, method: "forwardCDPCommand", params: { sessionId, method, params } }
 *       -> forward to chrome.debugger
 *   Extension -> Server:
 *     { method: "forwardCDPEvent", params: { sessionId, method, params } }
 *       -> forward chrome.debugger.onEvent to server
 */

export function debugLog(...args) {
  console.log('[Extension]', ...args);
}

export class RelayConnection {
  constructor(ws) {
    this._debuggee = {};
    this._ws = ws;
    this._closed = false;
    this.onclose = null;

    // Tab ID is set later via setTabId(); attachToTab waits for it.
    this._tabPromise = new Promise(resolve => {
      this._tabPromiseResolve = resolve;
    });

    this._ws.onmessage = (event) => this._onMessage(event);
    this._ws.onclose = () => this._onClose();

    // Store listeners for cleanup
    this._eventListener = (source, method, params) => this._onDebuggerEvent(source, method, params);
    this._detachListener = (source, reason) => this._onDebuggerDetach(source, reason);
    chrome.debugger.onEvent.addListener(this._eventListener);
    chrome.debugger.onDetach.addListener(this._detachListener);
  }

  // Either setTabId or close is called after creating the connection.
  setTabId(tabId) {
    this._debuggee = { tabId };
    this._tabPromiseResolve();
  }

  close(message) {
    this._ws.close(1000, message);
    // ws.onclose is called asynchronously, so we call it here to avoid forwarding
    // CDP events to the closed connection.
    this._onClose();
  }

  _onClose() {
    if (this._closed) return;
    this._closed = true;
    chrome.debugger.onEvent.removeListener(this._eventListener);
    chrome.debugger.onDetach.removeListener(this._detachListener);
    chrome.debugger.detach(this._debuggee).catch(() => {});
    this.onclose?.();
  }

  // ─── CDP events from browser -> server ──────────────────────────────────

  _onDebuggerEvent(source, method, params) {
    if (source.tabId !== this._debuggee.tabId) return;
    debugLog('Forwarding CDP event:', method, params);
    const sessionId = source.sessionId;
    this._sendMessage({
      method: 'forwardCDPEvent',
      params: { sessionId, method, params },
    });
  }

  _onDebuggerDetach(source, reason) {
    if (source.tabId !== this._debuggee.tabId) return;
    this.close(`Debugger detached: ${reason}`);
    this._debuggee = {};
  }

  // ─── Messages from server -> extension ──────────────────────────────────

  _onMessage(event) {
    this._onMessageAsync(event).catch(e => debugLog('Error handling message:', e));
  }

  async _onMessageAsync(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      debugLog('Error parsing message:', error);
      this._sendError(-32700, `Error parsing message: ${error.message}`);
      return;
    }

    debugLog('Received message:', message);

    const response = { id: message.id };
    try {
      response.result = await this._handleCommand(message);
    } catch (error) {
      debugLog('Error handling command:', error);
      response.error = error.message;
    }
    debugLog('Sending response:', response);
    this._sendMessage(response);
  }

  async _handleCommand(message) {
    if (message.method === 'attachToTab') {
      await this._tabPromise;
      debugLog('Attaching debugger to tab:', this._debuggee);
      await chrome.debugger.attach(this._debuggee, '1.3');
      const result = await chrome.debugger.sendCommand(this._debuggee, 'Target.getTargetInfo');
      return { targetInfo: result?.targetInfo };
    }
    if (!this._debuggee.tabId)
      throw new Error('No tab is connected.');
    if (message.method === 'forwardCDPCommand') {
      const { sessionId, method, params } = message.params;
      debugLog('CDP command:', method, params);
      const debuggerSession = { ...this._debuggee, sessionId };
      return await chrome.debugger.sendCommand(debuggerSession, method, params);
    }
  }

  _sendError(code, message) {
    this._sendMessage({
      error: { code, message },
    });
  }

  _sendMessage(message) {
    if (this._ws.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(message));
  }
}
