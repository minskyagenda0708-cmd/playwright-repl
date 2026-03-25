/**
 * Preloaded via NODE_OPTIONS --require.
 * Intercepts require('workerMain') → our pw-worker.cjs.
 * Our worker compiles tests + sends to bridge (one call per test file).
 */
'use strict';

if (!process.env.PW_BRIDGE_WORKER) return;

const customWorkerPath = require('path').resolve(__dirname, 'pw-worker.cjs');

// Intercept: when process.js requires workerMain, return our worker
const Module = require('module');
const origLoad = Module._load;

Module._load = function(request, parent) {
  // process.js does: require(runnerScript) where runnerScript includes 'workerMain'
  if (typeof request === 'string' && request.includes('workerMain')) {
    console.error('[pw] worker → bridge mode');
    return origLoad.call(this, customWorkerPath, parent);
  }
  return origLoad.apply(this, arguments);
};
