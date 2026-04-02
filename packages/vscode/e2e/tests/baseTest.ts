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

    // 2. Find VS Code CLI script (passes flags through to Electron, unlike Code.exe)
    //    Use VSCODE_CLI env var to override (e.g. for CI with downloaded VS Code)
    const defaultCodePath = process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
      : process.platform === 'darwin'
        ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
        : '/usr/bin/code';
    const codePath = process.env.VSCODE_CLI || defaultCodePath;

    // 3. Spawn VS Code with CDP port and our extension
    const userDataDir = path.join(tmpDir, 'user-data');
    const extensionsDir = path.join(tmpDir, 'extensions');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--extensionDevelopmentPath=${EXTENSION_PATH}`,
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
      projectDir,
    ];
    // On Windows, spawn .cmd with shell and quote the path
    const vscodeProcess: ChildProcess = spawn(`"${codePath}"`, args, {
      stdio: 'pipe',
      shell: true,
      windowsVerbatimArguments: false,
    });

    vscodeProcess.stderr?.on('data', (d) => process.stderr.write(`[vscode] ${d}`));

    // 4. Wait for CDP and connect Playwright
    await waitForCDP(CDP_PORT);
    const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const contexts = browser.contexts();
    const page = contexts[0]?.pages()[0] || await contexts[0]?.newPage();

    if (!page) throw new Error('No VS Code window found');

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
