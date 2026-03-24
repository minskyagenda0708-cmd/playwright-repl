/**
 * Bundle a test file for browser mode execution.
 *
 * Uses esbuild plugin to:
 * - Replace @playwright/test with our shim
 * - Transform Node.js calls (fs.*, Buffer.*, path.*) to __node.invoke()
 * - Everything else (page.*, expect, locator) stays untouched
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export async function bundleTestFile(testFilePath: string): Promise<string> {
  const esbuild = await import('esbuild');
  let shimPath = path.resolve(path.dirname(__filename), 'shim/test-runner.ts');
  if (!fs.existsSync(shimPath)) {
    shimPath = path.resolve(path.dirname(__filename), 'shim/test-runner.js');
  }

  const nodeTransformPlugin = {
    name: 'node-transform',
    setup(build: any) {
      // Transform .spec.ts / .test.ts files: fs/Buffer/path → __node.invoke()
      build.onLoad({ filter: /\.(spec|test)\.(ts|js|mjs)$/ }, (args: any) => {
        const source = fs.readFileSync(args.path, 'utf-8');
        const transformed = transformNodeCalls(source);
        return {
          contents: transformed,
          loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };

  const result = await esbuild.build({
    entryPoints: [testFilePath],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__tests',
    platform: 'browser',
    plugins: [nodeTransformPlugin],
    alias: {
      '@playwright/test': shimPath,
    },
    // Remove fs/path/etc from externals — they're transformed to __node.invoke()
    external: ['child_process', 'os', 'crypto', 'util', 'stream', 'events', 'net', 'http', 'https'],
  });

  const bundledCode = result.outputFiles[0].text;
  return `${bundledCode}\nawait globalThis.__runTests();\n`;
}

/**
 * Transform Node.js API calls to __node.invoke().
 * page.*, expect(), locator — ALL stay untouched.
 */
function transformNodeCalls(source: string): string {
  let result = source;

  // Remove fs/path imports (they're handled by __node.invoke)
  result = result.replace(/^import\s+.*\s+from\s+['"]fs['"];?\s*$/gm, '');
  result = result.replace(/^import\s+.*\s+from\s+['"]node:fs['"];?\s*$/gm, '');
  result = result.replace(/^import\s+.*\s+from\s+['"]path['"];?\s*$/gm, '');
  result = result.replace(/^import\s+.*\s+from\s+['"]node:path['"];?\s*$/gm, '');

  // Transform fs.method(...), Buffer.method(...), path.method(...) with bracket tracking
  result = replaceNodeCall(result, 'fs');
  result = replaceNodeCall(result, 'Buffer');
  result = replaceNodeCall(result, 'path');

  // process.env.X → await __node.invoke('process.env', 'X')
  result = result.replace(
    /\bprocess\.env\.(\w+)/g,
    (_match, key) => `await __node.invoke('process.env', '${key}')`,
  );

  return result;
}

/**
 * Replace module.method(args) with __node.invoke, handling nested parentheses.
 */
function replaceNodeCall(source: string, module: string): string {
  const pattern = new RegExp(`\\b${module}\\.(\\w+)\\(`, 'g');
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const method = match[1];
    const argsStart = match.index + match[0].length;

    // Track parentheses to find the matching close paren
    let depth = 1;
    let i = argsStart;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      if (source[i] === ')') depth--;
      i++;
    }

    const argsStr = source.substring(argsStart, i - 1); // content between parens
    result += source.substring(lastIndex, match.index);
    result += `await __node.invoke('${module}', '${method}', [${argsStr}])`;
    lastIndex = i;
    pattern.lastIndex = i; // continue searching after the replacement
  }

  result += source.substring(lastIndex);
  return result;
}
