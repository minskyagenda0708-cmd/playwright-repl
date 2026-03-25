/**
 * Preloaded via NODE_OPTIONS --require.
 * Patches chromium.launch → launchPersistentContext with extension.
 * Returns context._browser so Playwright fixtures work.
 * Reuses one context/page per worker.
 */
'use strict';

if (!process.env.PW_REUSE_CONTEXT) return;

const extPath = process.env.PW_EXT_PATH;
let sharedBrowser = null;
let sharedContext = null;
let sharedPage = null;

const Module = require('module');
const origLoad = Module._load;
let patched = false;

Module._load = function(request) {
  const result = origLoad.apply(this, arguments);

  if (!patched && typeof result === 'object' && result !== null &&
      result.chromium && result.chromium.launch && !result.chromium.launch._pwPatched) {
    patched = true;
    const chromium = result.chromium;
    const origLaunch = chromium.launch;
    origLaunch._pwPatched = true;

    chromium.launch = async function(options) {
      // Return cached browser
      if (sharedBrowser) return sharedBrowser;

      if (extPath) {
        // Extension mode: launchPersistentContext + channel:chromium
        var args = (options && options.args || []).concat([
          '--disable-extensions-except=' + extPath,
          '--load-extension=' + extPath,
          '--disable-background-timer-throttling',
        ]);

        var context = await chromium.launchPersistentContext('', {
          channel: 'chromium',
          headless: options ? options.headless : true,
          args: args,
        });

        sharedContext = context;
        sharedPage = context.pages()[0] || await context.newPage();
        console.error('[pw] extension + context reuse (pid ' + process.pid + ')');

        // Return real browser from persistent context
        var browser = context._browser;
        browser.newContext = async function() {
          context.newPage = async function() { return sharedPage; };
          context.close = async function() {};
          return context;
        };
        sharedBrowser = browser;
        return browser;
      }

      // No extension: regular launch + context reuse
      var browser = await origLaunch.apply(this, arguments);
      var origNewContext = browser.newContext.bind(browser);
      browser.newContext = async function(ctxOpts) {
        if (!sharedContext) {
          sharedContext = await origNewContext(ctxOpts);
          sharedPage = sharedContext.pages()[0] || await sharedContext.newPage();
          console.error('[pw] context reuse (pid ' + process.pid + ')');
        }
        sharedContext.newPage = async () => sharedPage;
        sharedContext.close = async () => {};
        return sharedContext;
      };
      sharedBrowser = browser;
      return browser;
    };
  }

  return result;
};
