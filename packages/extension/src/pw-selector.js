/**
 * Injected into every page's utility world via extendInjectedScript.
 *
 * Runs alongside Playwright's InjectedScript — has synchronous access to
 * generateSelectorSimple() and asLocator() for high-quality locator generation.
 *
 * Tags interacted elements with a `data-pw-locator` attribute (e.g.
 * `getByRole('button', { name: 'Submit' })`) so the content script recorder
 * can read it instead of using its own fallback locator generation.
 */
function PwSelector(injectedScript) {
  function tag(e) {
    try {
      var el = e.target;
      if (!el || !el.setAttribute) return;
      var sel = injectedScript.generateSelectorSimple(el);
      var locator = injectedScript.utils.asLocator('javascript', sel);
      el.setAttribute('data-pw-locator', locator);
    } catch { /* selector generation may fail on detached/special elements */ }
  }
  document.addEventListener('click', tag, true);
  document.addEventListener('input', tag, true);
  document.addEventListener('change', tag, true);
  document.addEventListener('keydown', tag, true);
}

module.exports = { default: function() { return PwSelector; } };
