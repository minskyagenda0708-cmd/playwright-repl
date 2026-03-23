# Test Runner Plan — Bridge Mode Execution

Issue: #328

## Goal

Run `.spec.ts` test files through the bridge for 35x faster execution via playwright-crx.
Tests use standard `import { test, expect } from '@playwright/test'` — no code changes needed.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  VS Code                                             │
│  1. User clicks "Run Test" on a .spec.ts file        │
│  2. esbuild bundles the file:                        │
│     - Compiles TS → JS                               │
│     - Bundles all imports into one script             │
│     - Aliases @playwright/test → our test-runner shim │
│  3. Sends bundled JS through bridge                  │
│  4. Displays results in terminal                     │
└──────────┬───────────────────────────────────────────┘
           │ bridge.runScript(bundledJs)
           ▼
┌──────────────────────────────────────────────────────┐
│  Chromium (playwright-crx)                           │
│  1. Service worker receives script                   │
│  2. Script evaluates: test/describe/beforeEach       │
│     register callbacks (no execution yet)            │
│  3. __runTests() executes all registered tests       │
│     using page/context/expect from playwright-crx    │
│  4. Returns formatted results                        │
└──────────────────────────────────────────────────────┘
```

## Components

### 1. Test Runner Shim (`packages/vscode/src/shim/test-runner.ts`)

Replaces `@playwright/test` at bundle time. Provides:

- `test(name, fn)` — register a test
- `test.only(name, fn)` — run only this test
- `test.skip(name, fn)` — skip this test
- `test.describe(name, fn)` — group tests
- `test.beforeEach(fn)` / `test.afterEach(fn)` — hooks
- `test.beforeAll(fn)` / `test.afterAll(fn)` — suite hooks
- `expect` — re-exported from playwright-crx
- `__runTests()` — executes all registered tests, returns results

**Flow:**
1. Script evaluates → test/describe calls register callbacks
2. `__runTests()` iterates suites → runs hooks → runs test fns
3. Each test fn receives `{ page, context, expect }` from playwright-crx scope
4. Results collected: pass/fail/skip with timing and error messages

### 2. Bundler (`packages/vscode/src/bundler.ts`)

Uses esbuild to prepare test files:

```typescript
esbuild.build({
  entryPoints: [testFile],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  alias: { '@playwright/test': shimPath }
});
```

- Compiles TypeScript → JavaScript
- Bundles all relative imports (page objects, helpers)
- Bundles browser-compatible npm packages (axios, lodash, etc.)
- Aliases `@playwright/test` to our shim
- Returns JS string (no file on disk)
- Appends `__runTests()` call to end of script

### 3. Bridge Integration

The bundled script is sent via `bridge.runScript(js, 'javascript')`.
The extension's `handleBridgeCommand` in background.ts executes it.

The script runs in the service worker scope where these globals exist:
- `page` — current attached page (playwright-crx)
- `context` — browser context
- `expect` — playwright-crx assertions

### 4. VS Code Command

"Playwright IDE: Run Test File" command:
1. Read active editor's file path
2. Bundle with esbuild
3. Send through bridge
4. Display results in REPL terminal

## What Works

- `test`, `test.describe`, `test.only`, `test.skip`
- `beforeEach`, `afterEach`, `beforeAll`, `afterAll`
- `page.*` — all Playwright page methods
- `expect()` — all Playwright assertions
- Relative imports (page objects, helpers)
- Browser-compatible npm packages
- Loops, conditionals, variables within tests
- TypeScript

## What Doesn't Work (V1 Limitations)

- Global setup/teardown (separate Node.js files)
- `test.use()` with custom fixtures
- `test.extend()` for custom fixtures
- Node.js APIs in test body (`fs`, `path`, `child_process`)
- Parallel workers
- Custom reporters
- `storageState` from disk

## Future: Hybrid Mode (V2)

Split test code between Node.js and bridge at compile time:
- Node.js APIs stay in Node.js process
- `page.*` / `expect()` calls compiled to `bridge.run()` calls
- Best of both worlds: full Node.js + 35x speed
- Requires AST analysis to identify browser vs Node.js code
