/**
 * Execute a test file via bridge mode.
 * Detects mode (browser vs compiler) and uses the appropriate path.
 */

import type { BridgeServer } from '@playwright-repl/core';
import type { RunOptions, TestResult } from './types.js';

export async function executeTestFile(
  testFilePath: string,
  bridge: BridgeServer,
  opts: RunOptions,
): Promise<TestResult[]> {
  // Detect mode
  const { detectTestMode } = await import('./mode-detect.js');
  const mode = await detectTestMode(testFilePath);

  let resultText: string;

  if (mode === 'browser') {
    // Browser mode: bundle with shim, send to bridge (fastest)
    const { bundleTestFile } = await import('./bundler.js');
    const script = await bundleTestFile(testFilePath);
    const result = await bridge.runScript(script, 'javascript');
    resultText = result.text || '';
  } else {
    // Compiler mode: transform page/expect → bridge.run(), execute in Node.js
    const { compileTestFile, executeCompiledTest } = await import('./compiler.js');
    const compiled = await compileTestFile(testFilePath);
    resultText = await executeCompiledTest(compiled, (cmd) => bridge.run(cmd));
  }

  return parseResults(resultText, testFilePath);
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
