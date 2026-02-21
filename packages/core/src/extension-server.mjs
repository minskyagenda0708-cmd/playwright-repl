/**
 * CommandServer — HTTP server for the side panel extension.
 *
 * Endpoints:
 *   POST /run     Panel commands → engine.run()
 *   GET  /health  Panel checks if server is running
 */

import { createServer } from 'node:http';
import { parseInput } from './parser.mjs';
import { replVersion } from './resolve.mjs';
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
  }

  get port() { return this._port; }

  async start(port = 6781) {
    this._server = createServer((req, res) => this._handleHttp(req, res));

    return new Promise((resolve, reject) => {
      this._server.listen(port, () => {
        this._port = this._server.address().port;
        resolve();
      });
      this._server.on('error', reject);
    });
  }

  async close() {
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

    // Health check endpoint
    if (req.method === 'GET' && urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: replVersion }));
      return;
    }

    // Panel command endpoint
    if (req.method === 'POST' && urlPath === '/run') {
      try {
        const body = await readBody(req);
        const { raw, activeTabUrl } = JSON.parse(body);
        console.log(`[server] ${raw} | ${activeTabUrl || 'no-url'}`);

        // Auto-select the tab matching the panel's active tab.
        if (activeTabUrl) {
          await withTimeout(this._engine.selectPageByUrl(activeTabUrl), 5000).catch(() => {});
        }

        let args = parseInput(raw);
        if (!args) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: `Unknown command: ${raw}`, isError: true }));
          return;
        }
        args = resolveArgs(args);
        const result = await withTimeout(this._engine.run(args), 30000);
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

  // ── go-back / go-forward → evaluate history.back/forward ──
  // Playwright's page.goBack() waits for load which can hang with bfcache in CDP mode.
  // Use history API directly — the user sees the browser live, no need to wait.
  if (cmdName === 'go-back') {
    args = { _: ['run-code', 'async (page) => { await page.evaluate(() => history.back()); return "Navigated back"; }'] };
  }
  if (cmdName === 'go-forward') {
    args = { _: ['run-code', 'async (page) => { await page.evaluate(() => history.forward()); return "Navigated forward"; }'] };
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

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Command timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
