/**
 * Preloaded via NODE_OPTIONS --require.
 * Patches browser.newContext to reuse one shared context/page per worker.
 * Each worker still launches its own browser (true parallelism).
 */
'use strict';

if (process.env.PW_REUSE_CONTEXT) {
  let sharedContext = null;
  let sharedPage = null;

  const Module = require('module');
  const origLoad = Module._load;
  let patched = false;

  Module._load = function(request) {
    const result = origLoad.apply(this, arguments);

    // Patch any module that exposes chromium.launch
    if (!patched && typeof result === 'object' && result !== null &&
        result.chromium && result.chromium.launch && !result.chromium.launch._pwPatched) {
      patched = true;
      const origLaunch = result.chromium.launch;
      origLaunch._pwPatched = true;

      result.chromium.launch = async function() {
        const browser = await origLaunch.apply(this, arguments);
        const origNewContext = browser.newContext.bind(browser);

        browser.newContext = async function(contextOptions) {
          if (!sharedContext) {
            sharedContext = await origNewContext(contextOptions);
            sharedPage = sharedContext.pages()[0] || await sharedContext.newPage();
            console.error('[pw] created shared context (worker ' + process.pid + ')');
          } else {
            console.error('[pw] REUSING context (worker ' + process.pid + ')');
            try { await sharedPage.goto('about:blank'); } catch {}
          }
          sharedContext.newPage = async () => sharedPage;
          sharedContext.close = async () => {};
          return sharedContext;
        };

        return browser;
      };
    }

    return result;
  };
}
