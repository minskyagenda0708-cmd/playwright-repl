/**
 * DevTools entry point — creates a "REPL" panel in Chrome DevTools.
 */
chrome.devtools.panels.create(
  'REPL',
  'icons/dramaturg_icon_16.png',
  'devtools/console.html',
);
