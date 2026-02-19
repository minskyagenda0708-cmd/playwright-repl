/**
 * Engine — in-process Playwright backend.
 *
 * Wraps BrowserServerBackend directly, eliminating the daemon process.
 * Provides the same interface as DaemonConnection: run(args), connected, close().
 *
 * Three connection modes:
 *   - launch:    new browser via Playwright (default)
 *   - connect:   existing Chrome via CDP port (--connect [port])
 *   - extension: DevTools extension CDP relay (--extension)
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';
import { replVersion } from './resolve.mjs';

// ─── Lazy-loaded Playwright dependencies ────────────────────────────────────

let _deps;

function loadDeps() {
  if (_deps) return _deps;
  const require = createRequire(import.meta.url);
  // Resolve absolute paths to bypass Playwright's exports map.
  const pwDir = path.dirname(require.resolve('playwright/package.json'));
  const pwReq = (sub) => require(path.join(pwDir, sub));
  _deps = {
    BrowserServerBackend:     pwReq('lib/mcp/browser/browserServerBackend.js').BrowserServerBackend,
    contextFactory:           pwReq('lib/mcp/browser/browserContextFactory.js').contextFactory,
    ExtensionContextFactory:  pwReq('lib/mcp/extension/extensionContextFactory.js').ExtensionContextFactory,
    resolveConfig:            pwReq('lib/mcp/browser/config.js').resolveConfig,
    commands:                 pwReq('lib/cli/daemon/commands.js').commands,
    parseCommand:             pwReq('lib/cli/daemon/command.js').parseCommand,
  };
  return _deps;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class Engine {
  /**
   * @param {object} [deps] — Playwright dependencies (injected for testing).
   */
  constructor(deps) {
    this._deps = deps;
    this._backend = null;
    this._close = null;
    this._connected = false;
  }

  get connected() {
    return this._connected;
  }

  /**
   * Start the engine with given options.
   * @param {object} opts - CLI options (headed, browser, connect, etc.)
   */
  async start(opts = {}) {
    const deps = this._deps || loadDeps();
    const config = await this._buildConfig(opts, deps);

    const cwd = url.pathToFileURL(process.cwd()).href;
    const clientInfo = {
      name: 'playwright-repl',
      version: replVersion,
      roots: [{ uri: cwd, name: 'cwd' }],
      timestamp: Date.now(),
    };

    // Choose context factory based on mode.
    let factory;
    if (opts.extension) {
      // Phase 1: ExtensionContextFactory (MCP Bridge) handles the CDP relay.
      // CommandServer only provides HTTP /run for panel commands.
      const { CommandServer } = await import('./extension-server.mjs');
      this._commandServer = new CommandServer(this);
      await this._commandServer.start(opts.port || 3000);

      // ExtensionContextFactory spawns Chrome with MCP Bridge extension,
      // creates CDPRelayServer, and connects Playwright through it.
      const extFactory = new deps.ExtensionContextFactory('chrome', undefined, undefined);
      const { browserContext, close } = await extFactory.createContext(
        clientInfo, new AbortController().signal, {},
      );
      this._close = close;

      const existingContextFactory = {
        createContext: () => Promise.resolve({ browserContext, close }),
      };
      this._backend = new deps.BrowserServerBackend(config, existingContextFactory, { allTools: true });
      await this._backend.initialize?.(clientInfo);
      this._connected = true;

      browserContext.on('close', () => {
        this._connected = false;
      });
    } else {
      // Launch/connect mode: eagerly create context for immediate feedback.
      factory = deps.contextFactory(config);
      const { browserContext, close } = await factory.createContext(
        clientInfo, new AbortController().signal, {},
      );
      this._close = close;

      const existingContextFactory = {
        createContext: () => Promise.resolve({ browserContext, close }),
      };
      this._backend = new deps.BrowserServerBackend(config, existingContextFactory, { allTools: true });
      await this._backend.initialize?.(clientInfo);
      this._connected = true;

      browserContext.on('close', () => {
        this._connected = false;
      });
    }
  }

  /**
   * Run a command given minimist-parsed args.
   * Returns { text, isError } matching DaemonConnection.run() shape.
   */
  async run(args) {
    if (!this._backend)
      throw new Error('Engine not started');

    const deps = this._deps || loadDeps();
    const command = deps.commands[args._[0]];
    if (!command)
      throw new Error(`Unknown command: ${args._[0]}`);

    const { toolName, toolParams } = deps.parseCommand(command, args);

    // Commands like "close", "list", "kill-all" have empty toolName.
    if (!toolName)
      return { text: `Command "${args._[0]}" is not supported in engine mode.` };

    toolParams._meta = { cwd: args.cwd || process.cwd() };

    const response = await this._backend.callTool(toolName, toolParams);
    return formatResult(response);
  }

  /**
   * Shut down the browser and backend.
   */
  async close() {
    this._connected = false;
    if (this._commandServer) {
      await this._commandServer.close();
      this._commandServer = null;
    }
    if (this._backend) {
      this._backend.serverClosed();
      this._backend = null;
    }
    if (this._close) {
      await this._close();
      this._close = null;
    }
  }

  // ─── Config builder ───────────────────────────────────────────────────────

  async _buildConfig(opts, deps) {
    const config = {
      browser: {
        browserName: 'chromium',
        launchOptions: {
          channel: 'chrome',
          headless: !opts.headed,
        },
        contextOptions: {
          viewport: null,
        },
        isolated: false,
      },
      server: {},
      network: {},
      timeouts: {
        action: opts.extension ? 30000 : 5000,
        navigation: 60000,
      },
    };

    // Browser selection
    if (opts.browser) {
      switch (opts.browser) {
        case 'firefox':
          config.browser.browserName = 'firefox';
          config.browser.launchOptions.channel = undefined;
          break;
        case 'webkit':
          config.browser.browserName = 'webkit';
          config.browser.launchOptions.channel = undefined;
          break;
        default:
          // chrome, msedge, chrome-beta, etc.
          config.browser.browserName = 'chromium';
          config.browser.launchOptions.channel = opts.browser;
          break;
      }
    }

    // Persistent profile
    if (opts.persistent || opts.profile) {
      config.browser.userDataDir = opts.profile || undefined;
    } else if (!opts.extension) {
      config.browser.isolated = true;
    }

    // CDP connect mode
    if (opts.connect) {
      const port = typeof opts.connect === 'number' ? opts.connect : 9222;
      config.browser.cdpEndpoint = `http://localhost:${port}`;
      config.browser.isolated = false;
    }

    return await deps.resolveConfig(config);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatResult(result) {
  const isError = result.isError;
  const text = result.content[0].type === 'text' ? result.content[0].text : undefined;
  return { isError, text };
}
