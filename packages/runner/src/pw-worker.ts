/**
 * pw-worker — custom Playwright worker using bridge/node hybrid.
 *
 * Replaces Playwright's workerMain.js. Speaks the same IPC protocol
 * (ProcessRunner) but compiles tests with our shim and routes through
 * bridge (browser) or real page (node).
 *
 * Protocol:
 * - Parent sends: runTestGroup({ file, entries })
 * - Worker dispatches: testBegin, testEnd, stepBegin, stepEnd, done
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(__filename);

// For now, delegate to the real worker.
// Phase 2: replace with our compile + shim + bridge execution.
const pwDir = path.dirname(require.resolve('playwright/package.json'));
const pwRequire = createRequire(path.join(pwDir, 'lib', 'index.js'));
const { create } = pwRequire('./worker/workerMain');
create('worker');
