/**
 * pw repl-extension — REPL that routes commands through the Chrome extension bridge.
 *
 * Starts a BridgeServer and waits for the extension to connect. The extension
 * retries every 3s, so start this after `pw launch --bridge-port <port>`.
 *
 * Usage:
 *   pw repl-extension --bridge-port 9877            # interactive REPL
 *   pw repl-extension --bridge-port 9877 bench.js   # run script, exit
 */

import repl from 'node:repl';
import { inspect } from 'node:util';
import fs from 'node:fs';
import { BridgeServer, minimist } from '@playwright-repl/core';

export async function handleReplExtension(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ['bridge-port'],
    default: { 'bridge-port': '9877' },
  });

  const bridgePort = parseInt(args['bridge-port'] as string, 10);
  const scriptFile = args._[0] as string | undefined;

  // Start BridgeServer and wait for extension to connect
  const bridge = new BridgeServer();
  await bridge.start(bridgePort);
  console.log(`BridgeServer on port ${bridge.port}`);
  console.log('Waiting for extension to connect...');
  await bridge.waitForConnection(30000);
  console.log('Extension connected.');

  // Script mode: read file, run through bridge, print timing, exit
  if (scriptFile) {
    const script = fs.readFileSync(scriptFile, 'utf-8');
    const start = performance.now();
    try {
      const result = await bridge.runScript(script, 'javascript');
      const elapsed = performance.now() - start;
      if (result.text) console.log(result.text);
      console.log(`${elapsed.toFixed(1)}ms${result.isError ? ' (error)' : ''}`);
    } catch (e: unknown) {
      const elapsed = performance.now() - start;
      console.error((e as Error).message);
      console.log(`${elapsed.toFixed(1)}ms (error)`);
    }
    await bridge.close();
    process.exit(0);
  }

  // Interactive mode: node:repl with custom eval → bridge.run()
  type EvalCb = (err: Error | null, result?: unknown) => void;
  let lastElapsed = 0;

  function formatValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return inspect(value, { depth: 1, colors: true });
  }

  const r = repl.start({
    prompt: 'pw> ',
    eval: (input: string, _context: object, _file: string, cb: EvalCb) => {
      const cmd = input.trim();
      if (!cmd) { cb(null, undefined); return; }
      const start = performance.now();
      bridge.run(cmd).then(
        (result) => {
          lastElapsed = performance.now() - start;
          if (result.isError) {
            cb(new Error(result.text || 'Unknown error'));
          } else {
            cb(null, result.text || undefined);
          }
        },
        (err) => {
          lastElapsed = performance.now() - start;
          cb(err as Error);
        },
      );
    },
    writer(value: unknown): string {
      const formatted = formatValue(value);
      const timing = `(${lastElapsed.toFixed(1)}ms)`;
      lastElapsed = 0;
      if (!formatted && !timing) return '';
      if (!formatted) return timing;
      return timing ? `${formatted}\n${timing}` : formatted;
    },
  });

  // Block until REPL exits (Ctrl+D / .exit)
  await new Promise<void>((resolve) => {
    r.on('exit', async () => {
      await bridge.close();
      resolve();
    });
  });
  process.exit(0);
}
