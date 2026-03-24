/**
 * Execute a test file in Node.js with Proxy page → bridge.
 * No mode detection. All tests run the same way.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { BridgeServer } from '@playwright-repl/core';
import { createPageProxy, createExpect } from './proxy-page.js';
import type { RunOptions, TestResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);

export async function executeTestFile(
  testFilePath: string,
  bridge: BridgeServer,
  _opts: RunOptions,
  nodePage?: any,
): Promise<TestResult[]> {
  // Compile with esbuild (TS → JS, alias @playwright/test → our shim)
  const compiled = await compile(testFilePath);

  // Set up Proxy page + smart expect on globalThis
  // nodePage (CDP) is used for route/waitForEvent; everything else goes to bridge
  const bridgeRun = async (cmd: string) => {
    const r = await bridge.run(cmd);
    if (r.isError) throw new Error(r.text || 'Bridge error');
    return r;
  };
  (globalThis as any).__proxyPage = createPageProxy(bridgeRun, nodePage);
  (globalThis as any).__proxyExpect = createExpect(bridgeRun);

  // Write to temp file and import
  const tmpFile = path.join(os.tmpdir(), `pw-test-${Date.now()}.mjs`);
  try {
    fs.writeFileSync(tmpFile, compiled);
    const mod = await import(`file://${tmpFile.replace(/\\/g, '/')}`);
    const resultText = typeof mod.default === 'string' ? mod.default : '';
    return parseResults(resultText, testFilePath);
  } finally {
    delete (globalThis as any).__proxyPage;
    delete (globalThis as any).__proxyExpect;
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function compile(testFilePath: string): Promise<string> {
  const esbuild = await import('esbuild');
  let shimPath = path.resolve(path.dirname(__filename), 'shim/test-runner-node.ts');
  if (!fs.existsSync(shimPath)) shimPath = shimPath.replace('.ts', '.js');

  const testDir = path.dirname(testFilePath);
  const testFileName = path.basename(testFilePath);

  const plugin = {
    name: 'proxy-runner',
    setup(build: any) {
      build.onResolve({ filter: /^__entry__$/ }, () => ({ path: '__entry__', namespace: 'entry' }));
      build.onLoad({ filter: /.*/, namespace: 'entry' }, () => ({
        contents: `
          import { __runTests } from '@playwright/test';
          import './${testFileName}';
          const result = await __runTests();
          export default result;
        `,
        resolveDir: testDir,
        loader: 'ts',
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: ['__entry__'],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [plugin],
    alias: { '@playwright/test': shimPath },
    external: [
      'fs', 'path', 'child_process', 'os', 'crypto', 'util',
      'stream', 'events', 'net', 'http', 'https', 'url',
      'worker_threads', 'node:*',
    ],
  });

  return result.outputFiles[0].text;
}

function parseResults(output: string, file: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const passMatch = lines[i].match(/^\s*[✓✔]\s+(.+?)\s+\((\d+)ms\)/);
    if (passMatch) {
      results.push({ name: passMatch[1], file, passed: true, skipped: false, duration: parseInt(passMatch[2]) });
      continue;
    }
    const failMatch = lines[i].match(/^\s*[✗✘]\s+(.+?)\s+\((\d+)ms\)/);
    if (failMatch) {
      const error = lines[i + 1]?.trim() || 'Test failed';
      results.push({ name: failMatch[1], file, passed: false, skipped: false, error, duration: parseInt(failMatch[2]) });
      continue;
    }
    const skipMatch = lines[i].match(/^\s*-\s+(.+?)\s+\(skipped\)/);
    if (skipMatch) {
      results.push({ name: skipMatch[1], file, passed: true, skipped: true, duration: 0 });
    }
  }

  return results;
}
