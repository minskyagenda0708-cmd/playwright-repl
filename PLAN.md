# PLAN.md — Roadmap

## Completed Phases (v0.1–v0.3)

### Phase 1: Core REPL (Done)

The foundation is built and working. A persistent REPL that connects to the Playwright MCP daemon over Unix socket.

- [x] DaemonConnection class (Unix socket client, newline-delimited JSON)
- [x] parseInput() with minimist matching daemon expectations
- [x] Command aliases (s→snapshot, c→click, o→open, g→goto, etc.)
- [x] Tab completion for commands and options
- [x] Command history (persisted to daemon cache dir)
- [x] Auto-start daemon if not running
- [x] Auto-reconnect on connection loss
- [x] Meta-commands (.help, .status, .aliases, .reconnect, .exit)
- [x] Timing display for slow commands (>500ms)
- [x] Boolean option handling (strip false defaults)
- [x] Async command queue (prevents race conditions on piped input)

### Phase 2: Modularize + Repo Setup (Done)

Refactored into clean modules for maintainability and extensibility.

- [x] Split into `src/` modules: connection, parser, workspace, repl, recorder, resolve, colors, index
- [x] Create `bin/playwright-repl.mjs` CLI entry point
- [x] Create `package.json` with proper metadata and bin field
- [x] Add verify commands (verify-text, verify-element, verify-value, verify-list) via run-code translation
- [x] Text-based locators — click/fill/check/etc. accept text args, auto-resolved to Playwright native locators
- [x] README.md with usage, examples, command reference, architecture

### Phase 3: Session Record & Replay (Done)

- [x] SessionRecorder class (captures commands, writes .pw files)
- [x] SessionPlayer class (reads .pw files, strips comments/blanks)
- [x] SessionManager state machine (idle/recording/paused/replaying)
- [x] .record / .save / .replay / .pause / .discard meta-commands
- [x] --replay CLI flag for headless execution
- [x] --step flag for interactive step-through
- [x] Error handling during replay (stop on error)
- [x] 6 example .pw files in examples/ (TodoMVC)

### Phase 4: Testing (Done)

- [x] Unit tests with vitest — 254 tests, 96% coverage
- [x] Tests for parser, connection, recorder, repl helpers, workspace
- [x] Cross-platform support (Windows named pipes)
- [x] v0.3.0: page-scripts refactor, run-code auto-wrap, eval raw parsing, red errors

---

## Architecture Redesign: Direct Engine + Monorepo (v0.4+)

### Problem

playwright-repl currently routes all commands through a Playwright daemon over Unix socket. This creates three limitations:

1. **vm sandbox** restricts `run-code` — no `expect`, no `require`, no full Node.js context
2. **Extension divergence** — the Chrome extension reimplements all commands via raw CDP (800 lines), can't share code with the REPL
3. **Daemon coupling** — adding commands requires daemon support; extra process to manage

### Solution

Replace the daemon with an **in-process Playwright engine**. Restructure into a **monorepo** so REPL and extension share the same core. Support **three browser connection modes**.

### Key Discovery

`BrowserServerBackend` from `playwright/lib/mcp/browser/browserServerBackend.js` can be instantiated directly in any Node.js process. It provides all 35+ tool handlers (click, fill, snapshot, run-code, etc.) without the daemon. The daemon's routing logic is ~15 lines we replicate in a new `Engine` class.

### Three Connection Modes

| Mode | Flag | What it does |
|------|------|-------------|
| **Launch** | `--headed` (default) | Launches a new Chromium instance via Playwright |
| **Connect** | `--connect [port]` | Connects to existing Chrome via CDP (`chrome --remote-debugging-port=9222`) |
| **Extension** | `--extension` | Starts WebSocket server; Chrome extension relays CDP from user's browser |

### Monorepo Structure

```
playwright-repl/
├── package.json                    # Root workspace config (private)
├── packages/
│   ├── core/                       # Shared engine + utilities
│   │   ├── package.json            # @playwright-repl/core (private, workspace)
│   │   ├── src/
│   │   │   ├── engine.mjs          # NEW: wraps BrowserServerBackend in-process
│   │   │   ├── parser.mjs          # MOVED from src/ (unchanged)
│   │   │   ├── page-scripts.mjs    # MOVED from src/ (unchanged)
│   │   │   ├── completion-data.mjs # MOVED from src/ (unchanged)
│   │   │   ├── colors.mjs          # MOVED from src/ (unchanged)
│   │   │   └── resolve.mjs         # MOVED from src/ (COMMANDS map, minimist)
│   │   └── test/
│   │       ├── engine.test.mjs     # NEW
│   │       ├── parser.test.mjs     # MOVED from test/
│   │       └── page-scripts.test.mjs # MOVED from test/
│   │
│   ├── cli/                        # Terminal REPL (published to npm as "playwright-repl")
│   │   ├── package.json            # name: "playwright-repl"
│   │   ├── bin/
│   │   │   └── playwright-repl.mjs # MOVED from bin/ (add --connect, --extension flags)
│   │   ├── src/
│   │   │   ├── repl.mjs            # MOVED from src/ (use Engine instead of DaemonConnection)
│   │   │   ├── recorder.mjs        # MOVED from src/ (unchanged)
│   │   │   └── index.mjs           # Public API exports
│   │   └── test/
│   │       ├── repl-processline.test.mjs  # MOVED (update imports)
│   │       └── ...other repl tests
│   │
│   └── extension/                  # Chrome DevTools panel extension
│       ├── package.json            # @playwright-repl/extension (private)
│       ├── manifest.json           # MOVED from playwright-repl-extension
│       ├── background.js           # REWRITTEN: thin WebSocket relay (~150 lines)
│       ├── panel/
│       │   ├── panel.html          # MOVED (unchanged)
│       │   ├── panel.js            # MOVED (minor: send via background WS relay)
│       │   └── panel.css           # MOVED (unchanged)
│       ├── content/
│       │   └── recorder.js         # MOVED (unchanged, still uses CDP for recording)
│       └── lib/
│           └── converter.js        # MOVED (unchanged, .pw → Playwright test export)
```

### Files to DELETE after migration
- `src/connection.mjs` — DaemonConnection (Unix socket client)
- `src/workspace.mjs` — daemon startup, socket paths
- `bin/daemon-launcher.cjs` — daemon launcher
- Extension's `lib/page-scripts.js`, `lib/locators.js`, `lib/formatter.js`, `lib/commands.js` (replaced by server-side Playwright)

---

## Phase 5: Monorepo Setup

**Goal**: Restructure into `packages/` layout with npm workspaces. No behavior changes — just move files.

**Status**: In progress (branch: `monorepo-restructure`, partial work stashed)

### Steps
1. Create `packages/core/`, `packages/cli/`, `packages/extension/`
2. Move files per structure above (via `git mv`)
3. Update all imports (relative paths change; CLI imports from `@playwright-repl/core`)
4. Add root `package.json` with `"workspaces": ["packages/*"]`
5. Run `npm install` to link workspaces
6. Run `npm test --workspaces` — all existing tests pass

### Verify
- `npm test --workspaces` — all 254 tests pass
- `node packages/cli/bin/playwright-repl.mjs --headed` — REPL still works via daemon (unchanged behavior)

---

## Phase 6: Engine (Core Change)

**Goal**: Create `Engine` class that wraps `BrowserServerBackend` in-process. REPL uses Engine by default.

### New file: `packages/core/src/engine.mjs` (~200 lines)

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { BrowserServerBackend } = require('playwright/lib/mcp/browser/browserServerBackend');
const { contextFactory } = require('playwright/lib/mcp/browser/browserContextFactory');

export class Engine {
  // Same interface as DaemonConnection: run(args), connected, close(), connect()
  async start(opts)       // Create config → factory → BrowserServerBackend → initialize
  async run(minimistArgs) // parseCliCommand(args) → backend.callTool(name, params) → format result
  async close()           // Shutdown backend + browser
  get connected()         // Boolean
}
```

**Key**: `Engine.run()` matches `DaemonConnection.run()` — returns `{ text: "..." }`. This means `repl.mjs`'s `processLine()` and `filterResponse()` work unchanged.

### Modify: `packages/cli/src/repl.mjs`

Replace daemon startup:
```js
// Before:
const conn = new DaemonConnection(socketPath(sessionName), replVersion);
await conn.connect();

// After:
const conn = new Engine();
await conn.start(opts);
```

### Verify
- `npm test --workspaces` — all tests pass
- `node packages/cli/bin/playwright-repl.mjs --headed` — launches browser in-process (no daemon!)
- `run-code await expect(page).toHaveTitle(...)` — works (no vm sandbox!)

---

## Phase 7: Connect Mode

**Goal**: `playwright-repl --connect [port]` connects to existing Chrome via CDP.

~30 lines in engine.mjs — map `opts.connect` to `cdpEndpoint` in config.

### Verify
```bash
chrome --remote-debugging-port=9222
node packages/cli/bin/playwright-repl.mjs --connect 9222
snapshot
click "Sign In"
```

---

## Phase 8: Extension Server + Extension Rewrite

**Goal**: `playwright-repl --extension` starts a WebSocket server. Chrome extension connects as a thin CDP relay. All 35+ commands handled by server-side Playwright — extension drops from 800 lines to ~150.

**Status**: In progress

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension (DevTools Panel)                      │
│                                                         │
│  panel.js ──sendMessage──► background.js                │
│     ▲                         │  ▲                      │
│     │ port.postMessage        │  │ chrome.debugger      │
│     │ (results, recording)    │  │ (CDP to tab)         │
│                               │  │                      │
└───────────────────────────────┼──┼──────────────────────┘
                     WebSocket  │  │
                                ▼  │
┌───────────────────────────────────────────────────────────┐
│  Node.js Server (playwright-repl --extension)             │
│                                                           │
│  ExtensionServer                                          │
│    ├── /extension WS  ← background.js connects here      │
│    ├── HTTP /json/*   ← Playwright CDP discovery          │
│    └── /devtools/*    ← Playwright CDP WebSocket          │
│                                                           │
│  Engine (BrowserServerBackend)                            │
│    └── connectOverCDP → local proxy → relay → extension   │
└───────────────────────────────────────────────────────────┘
```

### Three Connection Modes

| Mode | Flag | Browser Source | Use Case |
|------|------|---------------|----------|
| **Launch** | `--headed` (default) | Launches new Chromium via Playwright | General automation |
| **Connect** | `--connect [port]` | Existing Chrome with `--remote-debugging-port` | Debug running app |
| **Extension** | `--extension [--port N]` | User's normal Chrome via extension CDP relay | DevTools panel REPL |

### New file: `packages/core/src/extension-server.mjs` (~300 lines)

`ExtensionServer` class — HTTP + WebSocket server:

1. **CDP discovery** — `GET /json/version`, `GET /json` so Playwright can discover the relayed browser
2. **CDP relay** — WebSocket `/devtools/browser/{id}` accepts Playwright connection, forwards CDP to extension via `/extension` WebSocket
3. **Target domain** — handles `setDiscoverTargets`, `attachToTarget`, `detachFromTarget` to present the extension's tab as a Playwright target
4. **Command channel** — receives commands from panel (via background.js relay), routes through `Engine.run()`, returns results

### Extension rewrite: `packages/extension/background.js` (~150 lines, replaces 800)

Two roles:
1. **CDP relay**: connect to server WebSocket, bridge `chrome.debugger.sendCommand()` ↔ CDP messages
2. **Command proxy**: receive commands from panel via `chrome.runtime.onMessage`, forward to server, return results

Recording stays extension-side for Phase 8 (inject recorder.js, listen for `__pw:` events, forward to panel).

### Copied from `playwright-repl-extension` repo

- `panel/panel.html`, `panel/panel.css`, `panel/panel.js` (DevTools panel UI)
- `content/recorder.js` (event recorder injected into pages)
- `lib/converter.js` (.pw → Playwright test export)
- `devtools.html`, `devtools.js`, `manifest.json`, `icons/`

### Deleted (replaced by server-side Playwright)

- `lib/commands.js`, `lib/locators.js`, `lib/page-scripts.js`, `lib/formatter.js`

### Modify: `packages/core/src/engine.mjs` (+30 lines)

Extension mode in `start()`:
- Create `ExtensionServer`, start on `opts.port || 3000`
- Wait for extension to connect
- Set `cdpEndpoint` to local proxy
- Update `close()` to shut down ExtensionServer

### Modify: `packages/cli/bin/playwright-repl.mjs` (+5 lines)

- Add `--port` string option (default: 3000)
- Pass `port` to `startRepl(opts)`

### Verify
```bash
node packages/cli/bin/playwright-repl.mjs --extension --port 3000
# Load unpacked extension from packages/extension/
# Open website → DevTools → Playwright REPL panel
# snapshot, click e5, run-code, recording all work
```

---

## Phase 9: Cleanup

- Delete `src/connection.mjs`, `src/workspace.mjs`, `bin/daemon-launcher.cjs`
- Remove daemon-related code from repl.mjs
- Delete extension's `lib/page-scripts.js`, `lib/locators.js`, `lib/formatter.js`, `lib/commands.js`
- Update CLAUDE.md, README.md, CHANGELOG.md

---

## Phase Dependencies

```
Phase 5 (Monorepo) ✓ → Phase 6 (Engine) ✓ → Phase 7 (Connect) ✓
                                            → Phase 8 (Extension) ← current
                                            → Phase 9 (Cleanup)
```

Phases 7 and 8 are independent of each other. Phase 9 after all modes are verified.

## Key Risks

1. **Playwright internal imports** (`lib/mcp/browser/*`): Not public API, may break on upgrades. Mitigate by pinning Playwright version and testing on upgrade.
2. **Element refs** require `page._snapshotForAI()` (internal). Same risk — already used by daemon.
3. **Monorepo migration**: Import paths all change. Mitigate by doing Phase 5 as pure move with no behavior changes, verify all tests pass before proceeding.

## Backlog

- [ ] **Replace custom recorder with Playwright's recording infrastructure** — our `content/recorder.js` (188 lines) uses simple DOM heuristics for element identification. Playwright's recorder has battle-tested locator generation (getByRole → getByText → getByTestId fallback chain), shadow DOM/iframe handling, and years of edge case fixes. With the Engine running Playwright in-process, we could hook into Playwright's recording API and convert output to `.pw` format. Risk: Playwright's recording API is internal, and may assume codegen lifecycle (not "record while user browses" model). Investigate before committing.
- [ ] Variable substitution in .pw files (e.g., `${URL}`, `${USER}`)
- [ ] Create PR to Playwright repo to add `declareCommand()` entries for verify commands
- [ ] Add missing commands: keydown, keyup, mousemove, mousedown, mouseup, mousewheel, tracing, video, delete-data
- [ ] Integration tests with actual browser
- [ ] npx support (`npx playwright-repl`)
- [ ] Config file support (.playwright-repl.json)
- [ ] Plugin system for custom commands
