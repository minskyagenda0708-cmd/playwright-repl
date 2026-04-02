/**
 * Base test fixtures for VS Code E2E tests.
 *
 * Spawns VS Code as a child process with --remote-debugging-port,
 * then connects Playwright via CDP. No _electron.launch() needed.
 */
import { test as base, chromium, type Browser, type Page } from '@playwright/test';
export { expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const CDP_PORT = 9333; // avoid conflict with user's Chrome on 9222
const EXTENSION_PATH = path.resolve(import.meta.dirname, '..', '..');

type TestFixtures = {
  workbox: Page;
};

/** Wait until CDP endpoint responds */
async function waitForCDP(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, res => {
          res.resume();
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`CDP on port ${port} did not respond within ${timeoutMs}ms`);
}

/** Find the VS Code CLI script — checks globalSetup download first, then system install */
function findVSCodeCLI(): string {
  // Check .vscode-test/ (downloaded by globalSetup via @vscode/test-electron)
  // @ts-ignore — import.meta.dirname available in Node 22+
  const vscodeTestDir = path.resolve(import.meta.dirname, '..', '..', '.vscode-test');
  if (fs.existsSync(vscodeTestDir)) {
    for (const entry of fs.readdirSync(vscodeTestDir)) {
      const dir = path.join(vscodeTestDir, entry);
      // Windows: bin/code.cmd (CLI wrapper that passes flags through)
      // Linux: code (direct Electron binary — bin/code forks and exits)
      // macOS: .app bundle inside the version dir
      const candidates = [
        path.join(dir, 'bin', 'code.cmd'),  // Windows
        path.join(dir, 'code'),             // Linux direct binary
      ];
      // macOS: look for .app bundle inside the download dir
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        for (const sub of fs.readdirSync(dir)) {
          if (sub.endsWith('.app')) {
            candidates.push(path.join(dir, sub, 'Contents', 'Resources', 'app', 'bin', 'code'));
          }
        }
      }
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
  }
  // Fall back to system install
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
  if (process.platform === 'darwin')
    return '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  return '/usr/bin/code';
}

/** Copy fixture project to a temp dir so VS Code doesn't pollute the repo */
function copyFixtureProject(fixtureName = 'sample-project'): { tmpDir: string; projectDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-repl-e2e-'));
  // @ts-ignore — import.meta.dirname available in Node 22+
  const fixtureDir = path.resolve(import.meta.dirname, '..', 'fixtures', fixtureName);
  const projectDir = path.join(tmpDir, 'project');
  fs.cpSync(fixtureDir, projectDir, { recursive: true });
  return { tmpDir, projectDir };
}

export const test = base.extend<TestFixtures>({
  workbox: async ({}, use, testInfo) => {
    const { tmpDir, projectDir } = copyFixtureProject();

    // 2. Find VS Code CLI script
    //    Priority: VSCODE_CLI env var → downloaded by globalSetup → system install
    const codePath = process.env.VSCODE_CLI || findVSCodeCLI();

    // 3. Spawn VS Code with CDP port and our extension
    const userDataDir = path.join(tmpDir, 'user-data');
    const extensionsDir = path.join(tmpDir, 'extensions');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-sandbox',  // Required on Linux CI (chrome-sandbox not root-owned)
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--wait',
      `--extensionDevelopmentPath=${EXTENSION_PATH}`,
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
      projectDir,
    ];
    console.log(`[e2e] Launching VS Code: ${codePath}`);
    console.log(`[e2e] Args: ${args.join(' ')}`);
    const isCmd = codePath.endsWith('.cmd');
    const vscodeProcess: ChildProcess = isCmd
      ? spawn(`"${codePath}"`, args, { stdio: 'pipe', shell: true, windowsVerbatimArguments: false })
      : spawn(codePath, args, { stdio: 'pipe' });

    vscodeProcess.stdout?.on('data', (d) => process.stdout.write(`[vscode:out] ${d}`));
    vscodeProcess.stderr?.on('data', (d) => process.stderr.write(`[vscode:err] ${d}`));
    vscodeProcess.on('exit', (code) => console.log(`[e2e] VS Code exited with code ${code}`));

    // 4. Wait for CDP and connect Playwright
    await waitForCDP(CDP_PORT);
    const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

    // Wait for VS Code's main window to appear (may take a moment on CI)
    let page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      for (let i = 0; i < 30 && !page; i++) {
        await new Promise(r => setTimeout(r, 1000));
        page = browser.contexts()[0]?.pages()[0];
      }
    }
    if (!page) throw new Error('No VS Code window found after 30s');

    // Start tracing for debugging
    await page.context().tracing.start({ screenshots: true, snapshots: true, title: testInfo.title });

    await use(page);

    // Save trace
    const tracePath = testInfo.outputPath('trace.zip');
    await page.context().tracing.stop({ path: tracePath });
    testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });

    // Cleanup: close VS Code via CDP Browser.close on the browser-level WebSocket
    try {
      const { default: WebSocket } = await import('ws');
      const versionRes = await new Promise<string>((resolve, reject) => {
        http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, res => {
          let d = '';
          res.on('data', (c: string) => d += c);
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      const { webSocketDebuggerUrl } = JSON.parse(versionRes);
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
          setTimeout(resolve, 1000);
        });
        ws.on('error', () => resolve());
      });
    } catch {}
    await browser.close().catch(() => {});
    vscodeProcess.kill();
    await new Promise(r => setTimeout(r, 1000));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {};
  },
});
