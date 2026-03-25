/**
 * Preloaded via NODE_OPTIONS --require.
 * Patches browser.newContext to reuse shared context/page per worker.
 * Works with both launch (standard) and connect (pre-launched) modes.
 */
'use strict';

if (process.env.PW_REUSE_CONTEXT) {
  let sharedContext = null;
  let sharedPage = null;

  function patchBrowser(browser) {
    const origNewContext = browser.newContext.bind(browser);
    browser.newContext = async function(contextOptions) {
      if (!sharedContext) {
        sharedContext = await origNewContext(contextOptions);
        sharedPage = sharedContext.pages()[0] || await sharedContext.newPage();
        console.error('[pw] shared context created (pid ' + process.pid + ')');
      } else {
        try { await sharedPage.goto('about:blank'); } catch {}
      }
      sharedContext.newPage = async () => sharedPage;
      sharedContext.close = async () => {};
      return sharedContext;
    };
    return browser;
  }

  const Module = require('module');
  const origLoad = Module._load;
  let patched = false;

  Module._load = function(request) {
    const result = origLoad.apply(this, arguments);

    if (!patched && typeof result === 'object' && result !== null && result.chromium) {
      // Patch both launch and connect
      if (result.chromium.launch && !result.chromium.launch._pwPatched) {
        patched = true;
        const origLaunch = result.chromium.launch;
        origLaunch._pwPatched = true;
        result.chromium.launch = async function() {
          return patchBrowser(await origLaunch.apply(this, arguments));
        };
      }
      if (result.chromium.connect && !result.chromium.connect._pwPatched) {
        const origConnect = result.chromium.connect;
        origConnect._pwPatched = true;
        result.chromium.connect = async function() {
          return patchBrowser(await origConnect.apply(this, arguments));
        };
      }
    }

    return result;
  };
}
