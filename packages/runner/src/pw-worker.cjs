/**
 * pw-worker — custom Playwright worker that runs tests via bridge.
 *
 * Loaded by process.js: const { create } = require(runnerScript);
 * Each worker lazily launches its own browser + bridge on first runTestGroup,
 * then reuses them for all subsequent test groups assigned to this worker.
 *
 * Flow per test group:
 * 1. Compile test file with shim (esbuild)
 * 2. Send compiled code to bridge (one call)
 * 3. Parse results and dispatch events back to parent
 */
'use strict';

class BridgeWorker {
  constructor(params) {
    this._params = params;
    this._bridge = null;
    this._context = null;
  }

  async _ensureBridge() {
    if (this._bridge) return;

    const path = require('path');
    const coreMain = require.resolve('@playwright-repl/core');
    const coreUrl = 'file:///' + coreMain.replace(/\\/g, '/');
    const { BridgeServer } = await import(coreUrl);

    this._bridge = new BridgeServer();
    await this._bridge.start(0);

    const extPath = process.env.PW_EXT_PATH;
    const pw = require('playwright-core');
    this._context = await pw.chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        '--disable-extensions-except=' + extPath,
        '--load-extension=' + extPath,
        '--disable-background-timer-throttling',
      ],
    });

    let sw = this._context.serviceWorkers()[0];
    if (!sw) sw = await this._context.waitForEvent('serviceworker', { timeout: 10000 });
    await sw.evaluate(function(port) {
      chrome.storage.local.set({ bridgePort: port });
    }, this._bridge.port);

    await this._bridge.waitForConnection(10000);
    console.error('[pw-worker] bridge ready, port ' + this._bridge.port + ' (pid ' + process.pid + ')');
  }

  async runTestGroup(runPayload) {
    await this._ensureBridge();

    const file = runPayload.file;
    const entries = runPayload.entries;

    const compiled = await this._compile(file);

    const r = await this._bridge.runScript(`
      globalThis.__resetTestState();
      ${compiled}
      await globalThis.__runTests();
    `, 'javascript');

    const resultText = r.isError ? '' : (r.text || '');
    const lines = resultText.split('\n');

    for (const entry of entries) {
      const testId = entry.testId;

      this.dispatchEvent('testBegin', {
        testId: testId,
        startWallTime: Date.now(),
      });

      const testResult = this._findResult(lines, testId, entries);

      this.dispatchEvent('testEnd', {
        testId: testId,
        duration: testResult.duration,
        status: testResult.status,
        errors: testResult.errors,
        hasNonRetriableError: false,
        expectedStatus: 'passed',
        annotations: [],
        timeout: this._params.config?.timeout || 30000,
      });
    }

    this.dispatchEvent('done', {
      fatalErrors: r.isError ? [{ message: r.text }] : [],
      skipTestsDueToSetupFailure: [],
    });
    console.error('[pw-worker] group done, keeping bridge alive (pid ' + process.pid + ')');
  }

  _findResult(lines, testId, entries) {
    const idx = entries.findIndex(e => e.testId === testId);
    let currentIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^\s*[✓✔]/)) {
        currentIdx++;
        if (currentIdx === idx) {
          const dur = line.match(/\((\d+)ms\)/);
          return { status: 'passed', duration: dur ? parseInt(dur[1]) : 0, errors: [] };
        }
      } else if (line.match(/^\s*[✗✘]/)) {
        currentIdx++;
        if (currentIdx === idx) {
          const dur = line.match(/\((\d+)ms\)/);
          const errLine = lines[i + 1] || '';
          return {
            status: 'failed',
            duration: dur ? parseInt(dur[1]) : 0,
            errors: [{ message: errLine.trim() }],
          };
        }
      } else if (line.match(/^\s*-.*\(skipped\)/)) {
        currentIdx++;
        if (currentIdx === idx) {
          return { status: 'skipped', duration: 0, errors: [] };
        }
      }
    }

    return { status: 'failed', duration: 0, errors: [{ message: 'Test result not found' }] };
  }

  async _compile(testFilePath) {
    const esbuild = require('esbuild');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.dirname(testFilePath);
    const testFileName = path.basename(testFilePath);

    const shimPath = path.resolve(__dirname, 'shim', 'alias.ts');
    const shimPathJs = shimPath.replace('.ts', '.js');
    const aliasPath = fs.existsSync(shimPath) ? shimPath : shimPathJs;

    const plugin = {
      name: 'pw-bridge',
      setup(build) {
        build.onResolve({ filter: /^__entry__$/ }, () => ({ path: '__entry__', namespace: 'entry' }));
        build.onLoad({ filter: /.*/, namespace: 'entry' }, () => ({
          contents: 'import "./' + testFileName + '";',
          resolveDir: testDir,
          loader: 'ts',
        }));
      },
    };

    const result = await esbuild.build({
      entryPoints: ['__entry__'],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'neutral',
      plugins: [plugin],
      alias: { '@playwright/test': aliasPath },
    });

    return result.outputFiles[0].text;
  }

  dispatchEvent(method, params) {
    const response = { method: method, params: params };
    process.send({ method: '__dispatch__', params: response });
  }

  async gracefullyClose() {
    if (this._context) await this._context.close().catch(() => {});
    if (this._bridge) await this._bridge.close().catch(() => {});
  }
}

function create(params) {
  return new BridgeWorker(params);
}

module.exports = { create };
