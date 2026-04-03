# @playwright-repl/runner

Drop-in replacement for `npx playwright test` — 2.8x faster for browser-only tests.

## Performance

`pw test` compiles tests with esbuild and executes them directly in the browser via the Dramaturg Chrome extension's service worker (`serviceWorker.evaluate()`). This bypasses the Playwright test runner overhead (worker startup, TypeScript compilation, fixture setup).

Node-mode tests that need server-side APIs fall back to the standard Playwright test runner automatically.

## Quick Start

```bash
npm install -D @playwright-repl/runner
```

Replace `npx playwright test` with `pw test`:

```bash
pw test                         # run all tests
pw test todomvc/                # run tests in a folder
pw test --headless              # headless mode
```

## How It Works

1. **Compile** — esbuild bundles the test with a lightweight shim replacing `@playwright/test`
2. **Launch** — Chromium starts with the Dramaturg extension via `launchPersistentContext`
3. **Execute** — compiled test sent to the service worker via `serviceWorker.evaluate()`
4. **Results** — pass/fail returned directly, no test runner process needed

Tests that use Node-only APIs (`fs`, `net`, `child_process`) are detected by static analysis and fall back to standard Playwright automatically.

## pw Commands

```bash
pw test [files...]              # run Playwright tests (fast path)
pw repl                         # interactive REPL with keyword + JS support
pw repl --headless              # headless REPL for scripting
pw repl --port 9222             # connect to existing Chrome via CDP
```

### pw repl

Interactive REPL with keyword commands and JavaScript support. Launches Chromium with the extension by default.

```
pw> goto https://example.com
pw> await page.title()
Example Domain
(5ms)
pw> await page.locator('a').count()
1
(12ms)
```

## CI Setup

```yaml
- name: Install
  run: npm ci

- name: Install browsers
  run: npx playwright install --with-deps chromium

- name: Run tests
  run: npx pw test --headless
```

## Compatibility

Works with standard `@playwright/test` tests. No changes needed to your test files.

**Supported:** All Playwright test features — fixtures, assertions, test.describe, test.beforeEach, etc.

**Automatic fallback:** Tests that use Node-only APIs automatically fall back to standard Playwright.

## Development

```bash
cd packages/runner
pnpm run build
pnpm run test
```
