/**
 * pw repl — minimal Node REPL with Playwright globals.
 *
 * Connects to an existing Chrome via CDP, exposes page/context/browser/expect
 * on the REPL context, and lets you type raw Playwright API or plain JS.
 *
 * Usage:
 *   pw repl --port 9222            # interactive REPL
 *   pw repl --port 9222 bench.js   # run script, exit (browser stays alive)
 */

import repl from 'node:repl';
import { inspect } from 'node:util';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { minimist } from '@playwright-repl/core';

const __filename = fileURLToPath(import.meta.url);
const _require = createRequire(__filename);

export async function handleRepl(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ['port'],
    default: { port: '9222' },
  });

  const port = parseInt(args.port as string, 10);
  const scriptFile = args._[0] as string | undefined;

  // Connect to browser via CDP
  const pw = _require('@playwright/test');
  const browser = await pw.chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0];
  // Skip internal pages (devtools://, chrome://, about:)
  const pages = context?.pages() ?? [];
  const page = pages.find((p: { url: () => string }) => {
    const url = p.url();
    return !url.startsWith('devtools://') && !url.startsWith('chrome://') && !url.startsWith('about:');
  }) ?? pages[0];
  if (!page) {
    console.error('No page found. Open a page in the browser first.');
    process.exit(1);
  }

  const { expect } = _require('@playwright/test');

  console.log(`Connected to Chrome on port ${port}`);
  console.log(`Globals: page, context, browser, expect`);

  // Script mode: read file, eval each line, print timing, exit
  if (scriptFile) {
    const script = fs.readFileSync(scriptFile, 'utf-8');
    const fn = new Function('page', 'context', 'browser', 'expect',
      `return (async () => {\n${script}\n})()`);
    const start = performance.now();
    try {
      const result = await fn(page, context, browser, expect);
      const elapsed = performance.now() - start;
      if (result !== undefined) console.log(result);
      console.log(`\n${elapsed.toFixed(1)}ms`);
    } catch (e: unknown) {
      const elapsed = performance.now() - start;
      console.error((e as Error).message);
      console.log(`\n${elapsed.toFixed(1)}ms (error)`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Interactive mode: node:repl with Playwright globals + timing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EvalCb = (err: Error | null, result?: unknown) => void;
  let lastElapsed = 0;

  function formatValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    // Playwright Response object → short summary
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).status === 'function' && typeof (value as Record<string, unknown>).url === 'function') {
      const resp = value as { status: () => number; url: () => string };
      return `Response { ${resp.status()} ${resp.url()} }`;
    }
    // Primitives → simple string
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    // Default: inspect with depth limit
    return inspect(value, { depth: 1, colors: true });
  }

  const r = repl.start({
    prompt: 'pw> ',
    useGlobal: true,
    writer(value: unknown): string {
      const formatted = formatValue(value);
      const timing = `(${lastElapsed.toFixed(1)}ms)`;
      lastElapsed = 0;
      if (!formatted && !timing) return '';
      if (!formatted) return timing;
      return timing ? `${formatted}\n${timing}` : formatted;
    },
  });
  Object.assign(r.context, { page, context, browser, expect });

  // Wrap eval to track timing
  const originalEval = r.eval.bind(r);
  // @ts-expect-error — overriding readonly eval
  r.eval = (code: string, context: object, file: string, cb: EvalCb) => {
    const start = performance.now();
    originalEval(code, context, file, (err: Error | null, result?: unknown) => {
      lastElapsed = performance.now() - start;
      cb(err, result);
    });
  };

  // Block until REPL exits (Ctrl+D / .exit)
  await new Promise<void>((resolve) => {
    r.on('exit', () => resolve());
  });
  process.exit(0);
}
