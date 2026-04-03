/**
 * Base test fixtures for VS Code E2E tests.
 *
 * Builds a VSIX, installs it into a fresh VS Code, spawns VS Code
 * with --remote-debugging-port, then connects Playwright via CDP.
 */
import { test as base, chromium, type Browser, type Page } from '@playwright/test';
export { expect } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const CDP_PORT = 9333;
// @ts-ignore — import.meta.dirname available in Node 22+
const TESTS_DIR = import.meta.dirname;                          // e2e/tests/
const E2E_DIR = path.resolve(TESTS_DIR, '..');                  // e2e/
const EXTENSION_DIR = path.resolve(E2E_DIR, '..');              // packages/vscode/

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

/** Find the VS Code CLI — checks .vscode-test/ download first, then system install */
function findVSCodeCLI(): string {
  const vscodeTestDir = path.resolve(EXTENSION_DIR, '.vscode-test');
  if (fs.existsSync(vscodeTestDir)) {
    for (const entry of fs.readdirSync(vscodeTestDir)) {
      const dir = path.join(vscodeTestDir, entry);
      // Windows: bin/code.cmd, Linux: bin/code, macOS: .app bundle
      const candidates = [
        path.join(dir, 'bin', 'code.cmd'),
        path.join(dir, 'bin', 'code'),
      ];
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        for (const sub of fs.readdirSync(dir)) {
          if (sub.endsWith('.app'))
            candidates.push(path.join(dir, sub, 'Contents', 'Resources', 'app', 'bin', 'code'));
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

/** Build VSIX if not already built for current version */
function buildAndFindVSIX(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'package.json'), 'utf-8'));
  const vsixName = `playwright-repl-vscode-${pkg.version}.vsix`;
  const vsixPath = path.join(EXTENSION_DIR, vsixName);
  if (!fs.existsSync(vsixPath)) {
    console.log('[e2e] Building VSIX...');
    execSync('pnpm run package', { cwd: EXTENSION_DIR, stdio: 'inherit' });
  }
  if (!fs.existsSync(vsixPath))
    throw new Error(`VSIX not found at ${vsixPath} after build`);
  return vsixPath;
}

/** Copy fixture project to a temp dir */
function copyFixtureProject(fixtureName = 'sample-project'): { tmpDir: string; projectDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-repl-e2e-'));
  const fixtureDir = path.resolve(E2E_DIR, 'fixtures', fixtureName);
  const projectDir = path.join(tmpDir, 'project');
  fs.cpSync(fixtureDir, projectDir, { recursive: true });
  return { tmpDir, projectDir };
}

export const test = base.extend<TestFixtures>({
  workbox: async ({}, use, testInfo) => {
    const { tmpDir, projectDir } = copyFixtureProject();
    const codePath = process.env.VSCODE_CLI || findVSCodeCLI();
    const vsixPath = buildAndFindVSIX();

    const userDataDir = path.join(tmpDir, 'user-data');
    const extensionsDir = path.join(tmpDir, 'extensions');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    // 1. Install VSIX into the temp extensions dir
    console.log(`[e2e] Installing VSIX: ${vsixPath}`);
    execSync(
      `"${codePath}" --install-extension "${vsixPath}" --extensions-dir "${extensionsDir}" --force`,
      { stdio: 'pipe', shell: true as any }
    );

    // 2. Launch VS Code in normal mode (not extension development mode)
    const args = [
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
      projectDir,
    ];
    console.log(`[e2e] Launching VS Code: ${codePath}`);
    const vscodeProcess: ChildProcess = spawn(`"${codePath}"`, args, {
      stdio: 'pipe',
      shell: true,
    });

    vscodeProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[vscode:out] ${d}`));
    vscodeProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[vscode:err] ${d}`));
    vscodeProcess.on('exit', (code) => console.log(`[e2e] VS Code exited with code ${code}`));

    // 3. Wait for CDP and connect Playwright
    await waitForCDP(CDP_PORT);
    const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

    // Wait for VS Code's main window
    let page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      for (let i = 0; i < 30 && !page; i++) {
        await new Promise(r => setTimeout(r, 1000));
        page = browser.contexts()[0]?.pages()[0];
      }
    }
    if (!page) throw new Error('No VS Code window found after 30s');

    // Start tracing
    await page.context().tracing.start({ screenshots: true, snapshots: true, title: testInfo.title });

    await use(page);

    // Save trace
    const tracePath = testInfo.outputPath('trace.zip');
    await page.context().tracing.stop({ path: tracePath }).catch(() => {});
    testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });

    // Cleanup: close VS Code via CDP Browser.close
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
    if (!vscodeProcess.killed) vscodeProcess.kill();
    await new Promise<void>((resolve) => {
      if (vscodeProcess.exitCode !== null) return resolve();
      vscodeProcess.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });
    await new Promise(r => setTimeout(r, 1000));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {};
  },
});
