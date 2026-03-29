/**
 * Benchmark: pw repl (CDP) vs pw repl-extension (bridge)
 *
 * Usage: node packages/runner/script-examples/bench.js
 */

import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '../../..');
const pw = path.join(root, 'packages/runner/dist/pw-cli.js');
const script = path.join(root, 'packages/runner/script-examples/todomvc.js');
const RUNS = 5;
const headless = process.argv.includes('--headless');

function run(cmd) {
  const output = execSync(`node ${pw} ${cmd}`, { cwd: root, encoding: 'utf-8', timeout: 30000 });
  return output.trim();
}

function extractTime(output) {
  const match = output.match(/([\d.]+)ms/);
  return match ? parseFloat(match[1]) : null;
}

// 1. Launch browser
console.log('=== Launching browser ===');
const launchArgs = [pw, 'launch', '--port', '9222', '--bridge-port', '9877'];
if (headless) launchArgs.push('--headless');
const launchProc = spawn('node', launchArgs, {
  cwd: root,
  stdio: 'pipe',
});

// Wait for "Ready!" message
await new Promise((resolve) => {
  launchProc.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);
    if (text.includes('Ready!')) resolve();
  });
  launchProc.stderr.on('data', (data) => process.stderr.write(data));
});

// 2. Benchmark pw repl (CDP)
console.log(`\n=== pw repl (direct CDP) — ${RUNS} runs ===`);
const cdpTimes = [];
for (let i = 0; i < RUNS; i++) {
  const output = run(`repl --port 9222 "${script}"`);
  const ms = extractTime(output);
  if (ms !== null) cdpTimes.push(ms);
  console.log(`  Run ${i + 1}: ${ms}ms`);
}

// 3. Benchmark pw repl-extension (bridge)
console.log(`\n=== pw repl-extension (bridge) — ${RUNS} runs ===`);
const bridgeTimes = [];
for (let i = 0; i < RUNS; i++) {
  const output = run(`repl-extension --bridge-port 9877 "${script}"`);
  const ms = extractTime(output);
  if (ms !== null) bridgeTimes.push(ms);
  console.log(`  Run ${i + 1}: ${ms}ms`);
}

// 4. Summary
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const cdpAvg = avg(cdpTimes);
const bridgeAvg = avg(bridgeTimes);

console.log('\n=== Summary ===');
console.log(`  pw repl (CDP):       avg ${cdpAvg.toFixed(1)}ms  (${cdpTimes.map(t => t + 'ms').join(', ')})`);
console.log(`  pw repl-extension:   avg ${bridgeAvg.toFixed(1)}ms  (${bridgeTimes.map(t => t + 'ms').join(', ')})`);
console.log(`  Difference:          ${((1 - bridgeAvg / cdpAvg) * 100).toFixed(1)}% ${bridgeAvg < cdpAvg ? 'faster' : 'slower'} (bridge)`);

// 5. Close browser
console.log('\n=== Closing browser ===');
try { run('close --port 9222'); } catch {}
launchProc.kill();
console.log('Done.');
process.exit(0);
