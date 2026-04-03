/**
 * Base test fixtures for VS Code E2E tests.
 *
 * Launches VS Code once per worker, installs extension via VSIX,
 * connects Playwright via CDP, and shares the page across all tests.
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
const TESTS_DIR = import.meta.dirname;
const E2E_DIR = path.resolve(TESTS_DIR, '..');
const EXTENSION_DIR = path.resolve(E2E_DIR, '..');

type TestFixtures = {
  workbox: Page;
};

type WorkerFixtures = {
  vscodePage: Page;
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

/** Find VS Code CLI and launch binary */
function findVSCode(): { cli: string; launch: string } {
  const vscodeTestDir = path.resolve(EXTENSION_DIR, '.vscode-test');
  if (fs.existsSync(vscodeTestDir)) {
    for (const entry of fs.readdirSync(vscodeTestDir)) {
      const dir = path.join(vscodeTestDir, entry);
      const codeCmd = path.join(dir, 'bin', 'code.cmd');
      if (fs.existsSync(codeCmd))
        return { cli: codeCmd, launch: codeCmd };
      const codeBin = path.join(dir, 'bin', 'code');
      const codeDirect = path.join(dir, 'code');
      if (fs.existsSync(codeBin) && fs.existsSync(codeDirect))
        return { cli: codeBin, launch: codeDirect };
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        for (const sub of fs.readdirSync(dir)) {
          if (sub.endsWith('.app')) {
            const cli = path.join(dir, sub, 'Contents', 'Resources', 'app', 'bin', 'code');
            const launch = path.join(dir, sub, 'Contents', 'MacOS', 'Electron');
            if (fs.existsSync(cli) && fs.existsSync(launch))
              return { cli, launch };
          }
        }
      }
    }
  }
  if (process.platform === 'win32') {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
    return { cli: p, launch: p };
  }
  if (process.platform === 'darwin') {
    const cli = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    return { cli, launch: cli };
  }
  return { cli: '/usr/bin/code', launch: '/usr/bin/code' };
}

/** Build VSIX if not already built */
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

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Launch VS Code once per worker — shared across all tests
  vscodePage: [async ({}, use) => {
    const vscode = findVSCode();
    const codeCli = process.env.VSCODE_CLI || vscode.cli;
    const codeLaunch = vscode.launch;
    const vsixPath = buildAndFindVSIX();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-repl-e2e-'));
    const extensionsDir = path.join(tmpDir, 'extensions');
    const userDataDir = path.join(tmpDir, 'user-data');
    const projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });

    // Copy fixture project
    const fixtureDir = path.resolve(E2E_DIR, 'fixtures', 'sample-project');
    fs.cpSync(fixtureDir, projectDir, { recursive: true });

    // Install VSIX
    console.log(`[e2e] Installing VSIX: ${vsixPath}`);
    execSync(
      `"${codeCli}" --install-extension "${vsixPath}" --extensions-dir "${extensionsDir}" --force`,
      { stdio: 'pipe', shell: true as any }
    );

    // Launch VS Code
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
    console.log(`[e2e] Launching VS Code: ${codeLaunch}`);
    const isCmd = codeLaunch.endsWith('.cmd');
    const vscodeProcess: ChildProcess = isCmd
      ? spawn(`"${codeLaunch}"`, args, { stdio: 'pipe', shell: true, windowsVerbatimArguments: false })
      : spawn(codeLaunch, args, { stdio: 'pipe' });

    vscodeProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[vscode:out] ${d}`));
    vscodeProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[vscode:err] ${d}`));
    vscodeProcess.on('exit', (code) => console.log(`[e2e] VS Code exited with code ${code}`));

    // Connect Playwright via CDP
    await waitForCDP(CDP_PORT);
    const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

    let page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      for (let i = 0; i < 30 && !page; i++) {
        await new Promise(r => setTimeout(r, 1000));
        page = browser.contexts()[0]?.pages()[0];
      }
    }
    if (!page) throw new Error('No VS Code window found after 30s');

    await use(page);

    // Cleanup: close VS Code
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
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {};
  }, { scope: 'worker' }],

  // Each test gets the shared page
  workbox: async ({ vscodePage }, use) => {
    await use(vscodePage);
  },
});
