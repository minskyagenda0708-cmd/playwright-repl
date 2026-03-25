# Plan: pw as Playwright CLI Drop-in Replacement

## Context

Instead of building our own test discovery, scheduling, parallel execution, and reporting from scratch, we can **inherit from Playwright's real `TestRunner`** and override only the execution layer.

Playwright exposes:
- `TestRunner` class with `listTests()`, `runTests()`, `loadConfig()`
- `program` (Commander.js) with all CLI commands
- Reporter interface for custom output
- Full config system (`playwright.config.ts`)

We can make `pw` a **drop-in replacement** for `npx playwright test` that uses the same CLI, config, discovery, scheduling, reporters — but routes execution through our bridge/node hybrid.

## What Playwright's TestRunner Provides

```
playwright/lib/runner/testRunner.js → TestRunner class
  - loadConfig()       → reads playwright.config.ts
  - listFiles()        → discovers test files
  - listTests()        → parses test files, builds test tree
  - runTests()         → schedules, dispatches to workers, collects results
  - watch()            → watch mode

playwright/lib/program.js → CLI (Commander.js)
  - test command        → --grep, --project, --workers, --reporter, etc.
  - show-report         → HTML report viewer
  - merge-reports       → merge multiple report files
  - codegen             → code generator
```

## Architecture

```
pw test [options] [files]
  │
  ├── Uses Playwright's program (Commander.js) for CLI parsing
  ├── Uses Playwright's TestRunner for:
  │   ├── Config loading (playwright.config.ts)
  │   ├── Test discovery (testMatch, testIgnore, testDir)
  │   ├── Test tree building (describe, test, hooks)
  │   ├── Scheduling (parallel, serial, projects)
  │   ├── Reporters (list, html, json, junit, custom)
  │   └── Retries, timeouts, fixtures
  │
  └── Overrides the WORKER layer:
      ├── Instead of spawning Node worker processes
      ├── Routes tests through our bridge (browser) or direct page (node)
      └── Same tab attachment, same hybrid model
```

## Key Insight

Playwright's architecture separates:
1. **Runner** (scheduling, config, reporting) — we KEEP this
2. **Worker** (test execution) — we REPLACE this

The worker is where `page`, `context`, `browser` are created. We replace it with our bridge/node hybrid.

## Implementation Steps

### Step 1: Wrap Playwright's CLI
```ts
// packages/runner/src/cli.ts
const { program } = require('playwright/lib/program');

// Override the 'test' command to use our worker
// program.parse(process.argv);
```

### Step 2: Create a custom worker host
Playwright dispatches tests to `workerHost.js` which spawns child processes.
We replace this with our own worker that:
- Launches Chrome with extension (bridge mode)
- Or uses direct Node page (node mode)
- Routes page.* calls accordingly

### Step 3: Custom test execution
Override `processHost.js` or `workerHost.js`:
- Receives test to run
- Sets up page (bridge or node)
- Executes test function
- Reports results back to runner

### Step 4: Keep everything else
- Config loading ✓
- Test discovery ✓
- Test tree ✓
- Scheduling ✓
- Reporters ✓
- Retries ✓
- Timeouts ✓
- Projects ✓
- Grep/filter ✓

## What We Get

- `pw test` works exactly like `npx playwright test`
- Same CLI flags: --grep, --project, --workers, --reporter, --headed
- Same config: playwright.config.ts
- Same reporters: list, html, json, junit
- Same test discovery: testMatch, testIgnore
- Same parallel execution
- Same retries, timeouts
- Same VS Code Test Explorer integration
- But tests run through our bridge (faster) or node (hybrid)

## Files to Explore

- `playwright/lib/program.js` — CLI commands (Commander.js)
- `playwright/lib/runner/testRunner.js` — TestRunner class
- `playwright/lib/runner/workerHost.js` — worker process management
- `playwright/lib/runner/processHost.js` — process host for workers
- `playwright/lib/runner/dispatcher.js` — test dispatching
- `playwright/lib/runner/tasks.js` — task pipeline
- `playwright/lib/runner/taskRunner.js` — task execution

## Risk

- Playwright's internal APIs are not stable — they can change between versions
- We're pinned to `1.59.0-alpha` so this is manageable
- If APIs change, we update our overrides

## Verification

1. `pw test --list` shows same test tree as `npx playwright test --list`
2. `pw test --grep "click"` runs same tests as `npx playwright test --grep "click"`
3. `pw test --reporter=html` produces same HTML report
4. `pw test --workers=4` runs in parallel
5. `pw test` is faster than `npx playwright test` (bridge mode)
