# Backlog

## High Priority

- [ ] **History loads in wrong order** — `packages/cli/src/repl.mjs`: `.reverse()` before `.push()` means Up arrow shows oldest commands first instead of most recent
- [ ] **String escaping misses newlines** — `packages/cli/src/repl.mjs`: `esc()` for verify commands doesn't escape `\n`, `\r`, `\t` — multiline user input breaks generated code
- [ ] **Ghost completion crash on empty array** — `packages/cli/src/repl.mjs`: `renderGhost(matches[0])` has no guard if `cmds` is empty

- [ ] **Auto-inject `expect` in `run-code`** — auto-prepend `const { expect } = require('@playwright/test')` in the `run-code` auto-wrap so users can write `run-code await expect(page).toHaveTitle('Todo')` without manual imports

## Medium Priority

- [ ] **Failed commands not recorded** — `packages/cli/src/repl.mjs`: `session.record(line)` only runs after success; replay files miss failed commands
- [ ] **History write errors silently swallowed** — `packages/cli/src/repl.mjs`: `catch {}` hides disk-full or permission errors
- [ ] **Playwright version too loose** — `packages/cli/package.json`: `>=1.59.0-alpha` accepts any future version; pin to `<1.60.0` or similar
- [ ] **README lists commands that don't exist** — storage commands like `cookie-set`, `cookie-delete`, `localstorage-set` etc. are documented but not in COMMANDS

## Low Priority

- [ ] **`@types/chrome` types `sendCommand` as void** — `packages/extension/background.js`: `await chrome.debugger.sendCommand(...)`, `chrome.debugger.attach()`, `chrome.debugger.detach()` are correctly awaited (MV3 returns Promises) but `@types/chrome` still types them as `void`, causing IDE "await has no effect" warnings. Revisit when `@types/chrome` updates or if migrating to TypeScript.

- [ ] **Convert to TypeScript** — migrate `.mjs` files to `.ts` across `packages/core` and `packages/cli` for type safety and better IDE support
- [x] **Extension server (Phase 8)** — `playwright-repl --extension` starts a WebSocket server; extension connects as thin CDP relay instead of reimplementing all commands
- [ ] **Improve README structure** — Consider splitting README into per-package docs (`packages/cli/README.md`, `packages/extension/README.md`) with a concise root README linking to both. Current root README covers both CLI and extension but could be better organized.
- [ ] **Restructure the extension code structure, add src folder, and add build step
