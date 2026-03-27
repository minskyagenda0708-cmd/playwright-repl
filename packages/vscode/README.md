# Playwright REPL — VS Code Extension

Interactive Playwright REPL inside VS Code, powered by bridge mode for fast execution.

## Architecture

```
VS Code REPL (pseudoterminal)
  └─ BrowserManager
       ├─ BridgeServer (WebSocket :9876)
       └─ Chromium (Playwright's bundled, spawned with --load-extension)
            └─ Dramaturg extension
                 ├─ background.js → chrome.debugger (command execution)
                 └─ offscreen.js ──WebSocket──→ BridgeServer
```

Commands flow: VS Code REPL → BridgeServer → WebSocket → offscreen.js → background.js → chrome.debugger → browser.

## Development

```bash
# Build
cd packages/vscode
node build.mjs

# Watch mode
node build.mjs --watch

# Run (F5 in VS Code with the repo open)
# Uses .vscode/launch.json "Launch Extension" config
```

## Commands

- **Playwright REPL: Launch Browser** — spawns Chromium with extension, starts bridge
- **Playwright REPL: Open REPL** — opens the interactive terminal
- **Playwright REPL: Run Test File** — runs current file with Playwright Test
- **Playwright REPL: Stop Browser** — closes browser and bridge

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `playwright-repl.browser` | `chromium` | Browser to launch (`chromium`, `chrome`, `msedge`) |
| `playwright-repl.bridgePort` | `9876` | WebSocket bridge port |

## Key Files

- `src/extension.ts` — VS Code entry point, registers commands
- `src/browser.ts` — BrowserManager: spawns Chromium, manages BridgeServer
- `src/repl.ts` — Pseudoterminal REPL with command history
- `build.mjs` — esbuild bundler config (CJS output, externals: vscode, @playwright-repl/core)
