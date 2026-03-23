import type * as vscode from 'vscode';
import { BridgeServer } from '@playwright-repl/core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

// __filename is available at runtime in esbuild's CJS output
declare const __filename: string;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LaunchOptions {
  browser: string;
  bridgePort: number;
  headless?: boolean;
}

// ─── BrowserManager ────────────────────────────────────────────────────────

export class BrowserManager {
  private _bridge: BridgeServer | undefined;
  private _chromeProc: ChildProcess | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _browserContext: any = undefined;
  private _userDataDir: string | undefined;
  private _running = false;
  private _log: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this._log = outputChannel;
  }

  isRunning() { return this._running; }

  async launch(opts: LaunchOptions) {
    const _require = createRequire(__filename);

    // 1. Find Chromium executable via playwright-core
    const pw = _require('playwright-core');
    const execPath: string = pw.chromium.executablePath();
    if (!execPath || !fs.existsSync(execPath))
      throw new Error('Chromium not found. Run "npx playwright install chromium".');
    this._log.appendLine(`Chromium: ${execPath}`);

    // 2. Find the extension dist path (sibling package in monorepo)
    const coreMain = _require.resolve('@playwright-repl/core');
    const coreDir = coreMain.replace(/[\\/]dist[\\/].*$/, '');
    const extPath = path.resolve(coreDir, '../extension/dist');
    if (!fs.existsSync(path.join(extPath, 'manifest.json')))
      throw new Error(`Extension not built. Run "pnpm run build" first. Expected: ${extPath}`);
    this._log.appendLine(`Extension: ${extPath}`);

    // 3. Start BridgeServer (WebSocket)
    const bridge = new BridgeServer();
    await bridge.start(opts.bridgePort || 9876);
    this._bridge = bridge;
    this._log.appendLine(`BridgeServer on port ${bridge.port}`);

    // 4. Launch Chromium with extension
    const extArgs = [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-infobars',
    ];

    if (opts.headless) {
      // Headless: use launchPersistentContext (handles headless + extensions properly)
      this._log.appendLine('Launching headless Chromium...');
      this._browserContext = await pw.chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: true,
        args: [...extArgs, 'https://www.google.com'],
        env: Object.fromEntries(
          Object.entries(process.env).filter(([k]) =>
            !k.startsWith('ELECTRON_') && !k.startsWith('VSCODE_') && k !== 'ORIGINAL_XDG_CURRENT_DESKTOP'
          ),
        ),
      });
      this._log.appendLine('Headless Chromium launched.');
    } else {
      // Headed: spawn directly (launchPersistentContext doesn't load extensions from VS Code)
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-ide-'));
      this._userDataDir = userDataDir;

      const chromeArgs = [
        `--user-data-dir=${userDataDir}`,
        ...extArgs,
        'https://www.google.com',
      ];
      this._log.appendLine(`Spawning: ${execPath}`);

      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(([k]) =>
          !k.startsWith('ELECTRON_') && !k.startsWith('VSCODE_') && k !== 'ORIGINAL_XDG_CURRENT_DESKTOP'
        ),
      );

      this._chromeProc = spawn(execPath, chromeArgs, {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv,
      });
      this._chromeProc.stdout?.on('data', (d: Buffer) => this._log.appendLine(`[chrome] ${d.toString().trim()}`));
      this._chromeProc.stderr?.on('data', (d: Buffer) => this._log.appendLine(`[chrome] ${d.toString().trim()}`));
      this._chromeProc.unref();
      this._log.appendLine('Chromium spawned.');
    }
    this._log.appendLine('Waiting for extension to connect...');

    // 5. Wait for offscreen document to connect via WebSocket
    await bridge.waitForConnection(30000);
    this._running = true;
    this._log.appendLine('Extension connected. Bridge ready.');


  }

  async stop() {
    if (this._bridge) {
      await this._bridge.close().catch(() => {});
      this._bridge = undefined;
    }
    if (this._browserContext) {
      await this._browserContext.close().catch(() => {});
      this._browserContext = undefined;
    }
    if (this._chromeProc) {
      try { this._chromeProc.kill(); } catch { /* ignore */ }
      this._chromeProc = undefined;
    }
    if (this._userDataDir) {
      fs.rmSync(this._userDataDir, { recursive: true, force: true });
      this._userDataDir = undefined;
    }
    this._running = false;
  }

  async runCommand(raw: string): Promise<{ text?: string; isError?: boolean }> {
    if (!this._bridge) {
      return { text: 'Bridge not started', isError: true };
    }
    return this._bridge.run(raw);
  }

  async runScript(script: string, language: 'pw' | 'javascript' = 'javascript'): Promise<{ text?: string; isError?: boolean }> {
    if (!this._bridge) {
      return { text: 'Bridge not started', isError: true };
    }
    return this._bridge.runScript(script, language);
  }
}
