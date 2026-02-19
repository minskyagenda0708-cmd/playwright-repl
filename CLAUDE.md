# CLAUDE.md — Context for Claude Code

## Project Overview

**playwright-repl** is an interactive REPL (Read-Eval-Print Loop) for browser automation that runs Playwright's `BrowserServerBackend` in-process via an `Engine` class. No daemon, no socket — commands execute directly.

Think of it as a **keyword-driven test runner** (like Robot Framework) backed by Playwright instead of Selenium.

## Monorepo Structure

```
playwright-repl/
├── package.json                    # Root workspace config (npm workspaces)
├── packages/
│   ├── core/                       # Shared engine + utilities
│   │   ├── src/
│   │   │   ├── engine.mjs          # Wraps BrowserServerBackend in-process
│   │   │   ├── parser.mjs          # Command parsing + alias resolution
│   │   │   ├── page-scripts.mjs    # Text locators + assertion helpers
│   │   │   ├── completion-data.mjs # Ghost completion items
│   │   │   ├── extension-server.mjs # WebSocket server for extension CDP relay
│   │   │   ├── colors.mjs          # ANSI color helpers
│   │   │   └── resolve.mjs         # COMMANDS map, minimist re-export
│   │   └── test/
│   │
│   ├── cli/                        # Terminal REPL (published as "playwright-repl")
│       ├── bin/
│       │   └── playwright-repl.mjs # CLI entry point
│       ├── src/
│       │   ├── repl.mjs            # Interactive readline loop
│       │   ├── recorder.mjs        # Session recording/replay
│       │   └── index.mjs           # Public API exports
│       ├── test/
│       └── examples/               # .pw session files
│
│   └── extension/                  # Chrome DevTools panel extension
│       ├── manifest.json           # Manifest V3 config
│       ├── background.js           # Thin CDP relay + command proxy (~150 lines)
│       ├── panel/                  # DevTools panel UI
│       │   ├── panel.html
│       │   ├── panel.js
│       │   └── panel.css
│       ├── content/
│       │   └── recorder.js         # Event recorder injected into pages
│       └── lib/
│           └── converter.js        # .pw → Playwright test export
```

## Architecture

### The Three Layers

```
Layer 1: CLI keyword → MCP tool name (commands.js from Playwright)
  "click"     → "browser_click"
  "goto"      → "browser_navigate"
  "press"     → "browser_press_key"
  "fill"      → "browser_type"
  "snapshot"  → "browser_snapshot"

Layer 2: MCP tool name → handle() function (tools/*.js in Playwright)
  backend.callTool("browser_click", { ref: "e5" })
  → looks up tool in registry → calls handle()

Layer 3: handle() → Playwright API
  browser_click  → locator.click()
  browser_navigate → page.goto()
  browser_press_key → page.keyboard.press()
  browser_snapshot → accessibility tree walk via CDP
```

### Full Command Flow

```
User types:  "click e5"
  ↓ alias resolution (REPL layer)
tokens:      ["click", "e5"]
  ↓ minimist parsing
args:        { _: ["click", "e5"] }
  ↓ Engine.run(args)
  ↓ parseCommand(command, args)
toolName:    "browser_click"
toolParams:  { ref: "e5" }
  ↓ backend.callTool(toolName, toolParams)
  ↓ Playwright API
browser:     locator.click()
  ↓ CDP WebSocket
Chrome:      actual DOM click event
```

### Engine (packages/core/src/engine.mjs)

The `Engine` class wraps Playwright's `BrowserServerBackend` in-process:

```js
const engine = new Engine();
await engine.start({ headed: true, browser: 'chrome' });
const result = await engine.run({ _: ['click', 'e5'] });
// result = { text: '### Result\nClicked', isError: false }
await engine.close();
```

Three connection modes via `start(opts)`:
- **launch** (default): `contextFactory(config)` → new browser
- **connect**: `opts.connect = 9222` → `cdpEndpoint` → `connectOverCDP()`
- **extension**: `opts.extension = true` → starts `ExtensionServer`, Chrome extension relays CDP from user's browser
- Dependency injection: constructor accepts `deps` for testing

Key Playwright internals used (via `createRequire`):
- `playwright/lib/mcp/browser/browserServerBackend` → `BrowserServerBackend`
- `playwright/lib/mcp/browser/browserContextFactory` → `contextFactory`
- `playwright/lib/mcp/browser/config` → `resolveConfig`
- `playwright/lib/mcp/terminal/commands` → `commands` map
- `playwright/lib/mcp/terminal/command` → `parseCommand`

### ExtensionServer (packages/core/src/extension-server.mjs)

When `--extension` mode is used, `ExtensionServer` starts an HTTP + WebSocket server:

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension (DevTools Panel)                      │
│  panel.js ──sendMessage──► background.js                │
│     ▲                         │  ▲                      │
│     │ port.postMessage        │  │ chrome.debugger      │
└───────────────────────────────┼──┼──────────────────────┘
                     WebSocket  │  │
                                ▼  │
┌───────────────────────────────────────────────────────────┐
│  ExtensionServer                                          │
│    ├── /extension WS  ← background.js connects here      │
│    ├── HTTP /json/*   ← Playwright CDP discovery          │
│    └── /devtools/*    ← Playwright CDP WebSocket          │
│  Engine → connectOverCDP → local proxy → relay → ext      │
└───────────────────────────────────────────────────────────┘
```

- **CDP relay**: background.js bridges `chrome.debugger` ↔ WebSocket so Playwright can control the user's browser
- **Command channel**: panel sends commands via background.js → server → `Engine.run()` → results back
- **Recording**: stays extension-side (inject recorder.js, listen for `__pw:` events)

### Element Refs (e1, e5, etc.)

When you run `snapshot`, Playwright walks the page's accessibility tree via CDP, assigns short refs like `e1`, `e2`, `e5` to interactive elements. When you later say `click e5`, it resolves back via the backend's internal ref tracking.

## Key Implementation Details

### Boolean Option Handling

minimist sets all declared boolean options to `false` by default. Solution: strip false-valued booleans not explicitly passed by user:

```js
for (const opt of booleanOptions) {
  if (args[opt] === false) {
    const hasExplicitNo = tokens.some(t => t === `--no-${opt}`);
    if (!hasExplicitNo) delete args[opt];
  }
}
```

### Async Command Serialization

When piping commands or replaying, readline emits all 'line' events immediately. Async handlers overlap, causing race conditions. Solution: command queue:

```js
let processing = false;
const commandQueue = [];
async function processQueue() {
  if (processing) return;
  processing = true;
  while (commandQueue.length > 0) {
    await processLine(commandQueue.shift());
  }
  processing = false;
}
```

## Tech Stack

- **Runtime**: Node.js (ESM modules, `.mjs`)
- **Dependencies**: `minimist` (command parsing), `playwright@>=1.59.0-alpha` (browser engine), `ws` (WebSocket server for extension mode)
- **Monorepo**: npm workspaces (`packages/core`, `packages/cli`, `packages/extension`)
- **Testing**: vitest
- **Key insight**: `playwright@1.59.0-alpha` includes `lib/mcp/browser/` (BrowserServerBackend, contextFactory).
  The stable `playwright@1.58` does NOT. Once 1.59 goes stable, the alpha pin can be removed.
- No build step — plain ESM JavaScript

## Code Style

- ESM imports (`import ... from`)
- Async/await throughout
- No TypeScript (keep it simple, scripting-oriented)
- Sections separated by `// ─── Section Name ───` comments
