/**
 * Preloaded via NODE_OPTIONS --require.
 * Intercepts require('workerMain') → loads REAL workerMain, then patches
 * its create() to wrap runTestGroup with bridge/Node routing.
 *
 * Bridge-compatible tests: compile + send to bridge (fast path)
 * Node-dependent tests: real WorkerMain handles everything (normal path)
 */

import Module = require('module');
import path = require('path');

const origLoad = (Module as any)._load;

(Module as any)._load = function (request: string, parent: unknown) {
  if (typeof request === 'string' && request.includes('workerMain')) {
    console.error('[pw] patching workerMain');
    const realModule = origLoad.call(this, request, parent);
    const origCreate = realModule.create;

    return {
      create(params: unknown) {
        const worker = origCreate(params);
        const bridge = require(path.resolve(__dirname, 'pw-worker.cjs'));
        bridge.patchWorker(worker, params);
        return worker;
      },
    };
  }
  return origLoad.apply(this, arguments);
};
