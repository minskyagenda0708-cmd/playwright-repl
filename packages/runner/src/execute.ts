/**
 * Execute a test file via bridge mode.
 * Detects if test needs Node.js (compiler mode) or can run in browser.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { BridgeServer } from '@playwright-repl/core';
import type { RunOptions, TestResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);

const NODE_BUILTINS = new Set([
  'fs', 'path', 'child_process', 'os', 'crypto', 'util',
  'stream', 'events', 'net', 'http', 'https', 'url',
  'worker_threads',
]);

function needsNodeJs(source: string): boolean {
  for (const mod of NODE_BUILTINS) {
    if (source.includes(`from '${mod}'`) || source.includes(`from "node:${mod}"`)) return true;
  }
  if (/process\.env\b|__dirname\b|__filename\b/.test(source)) return true;
  return false;
}

export async function executeTestFile(
  testFilePath: string,
  bridge: BridgeServer,
  opts: RunOptions,
): Promise<TestResult[]> {
  const source = fs.readFileSync(testFilePath, 'utf-8');

  if (!needsNodeJs(source)) {
    // Browser mode: bundle with shim, send to bridge (fastest)
    const { bundleTestFile } = await import('./bundler.js');
    const script = await bundleTestFile(testFilePath);
    const result = await bridge.runScript(script, 'javascript');
    return parseResults(result.text || '', testFilePath);
  }

  // Compiler mode: transform page/expect → bridge.run(), run in Node.js
  console.log('  [compiler mode]');
  const compiled = await compileForNode(testFilePath);
  const resultText = await executeInNode(compiled, bridge);
  return parseResults(resultText, testFilePath);
}

async function compileForNode(testFilePath: string): Promise<string> {
  const esbuild = await import('esbuild');
  const shimPath = path.resolve(path.dirname(__filename), 'shim/test-runner-node.ts');
  const shimFallback = path.resolve(path.dirname(__filename), 'shim/test-runner-node.js');
  const shim = fs.existsSync(shimPath) ? shimPath : shimFallback;
  const testDir = path.dirname(testFilePath);
  const testFileName = path.basename(testFilePath);

  const plugin = {
    name: 'compiler',
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
      // Transform test files
      build.onLoad({ filter: /\.(spec|test)\.(ts|js|mjs)$/ }, (args: any) => {
        const src = fs.readFileSync(args.path, 'utf-8');
        return {
          contents: transformForBridge(src),
          loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };

  const result = await esbuild.build({
    entryPoints: ['__entry__'],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [plugin],
    alias: { '@playwright/test': shim },
    external: [...NODE_BUILTINS].flatMap(m => [m, `node:${m}`]),
  });

  return result.outputFiles[0].text;
}

function transformForBridge(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
      output.push(line);
      i++;
      continue;
    }

    // Detect browser line: any line with page. or expect( or Promise.all with page
    const isBrowserLine = /\bpage\b[.(]/.test(trimmed) || /\bexpect\s*\(/.test(trimmed);

    if (isBrowserLine) {
      const indent = line.match(/^(\s*)/)?.[1] || '';
      // Collect consecutive browser lines into one block
      const block: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.trim();
        if (!t) { i++; continue; } // skip blank lines inside block
        // Keep collecting if line references page, expect, or a variable from previous lines
        const isRelated = /\bpage\b[.(]/.test(t) || /\bexpect\s*\(/.test(t) ||
          /^\s*(?:const|let|var)\s+/.test(t) && block.length > 0 ||
          /^\s*await\s+/.test(t) && block.length > 0 ||
          /^\s*\]/.test(t) || /^\s*\)/.test(t); // closing brackets
        if (!isRelated && block.length > 0) break;
        // Collect multi-line expression (track brackets)
        let expr = t;
        let depth = 0;
        for (const ch of t) {
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          if (ch === ')' || ch === ']' || ch === '}') depth--;
        }
        i++;
        while (depth > 0 && i < lines.length) {
          expr += '\n' + lines[i].trim();
          for (const ch of lines[i]) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            if (ch === ')' || ch === ']' || ch === '}') depth--;
          }
          i++;
        }
        block.push(expr);
      }
      const blockCode = block.join('\n').replace(/;?\s*$/, '');
      output.push(`${indent}await bridge.run(${JSON.stringify(blockCode)});`);
    } else {
      output.push(line);
      i++;
    }
  }

  return output.join('\n');
}

async function executeInNode(compiled: string, bridge: BridgeServer): Promise<string> {
  // Set bridge.run as global
  (globalThis as any).bridge = {
    run: async (command: string) => {
      const r = await bridge.run(command);
      if (r.isError) throw new Error(r.text || 'Bridge command failed');
      return r;
    },
  };

  const tmpFile = path.join(os.tmpdir(), `pw-test-${Date.now()}.mjs`);

  try {
    fs.writeFileSync(tmpFile, compiled);
    const mod = await import(`file://${tmpFile.replace(/\\/g, '/')}`);
    return typeof mod.default === 'string' ? mod.default : '(no output)';
  } finally {
    delete (globalThis as any).bridge;
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
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
