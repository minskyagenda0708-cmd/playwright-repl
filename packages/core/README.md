# @playwright-repl/core

Shared parser, connections, and utilities for the playwright-repl ecosystem.

Used by [`playwright-repl`](../cli/README.md) (CLI), [`@playwright-repl/runner`](../runner/README.md) (runner), [`@playwright-repl/mcp`](../mcp/README.md) (MCP server), and the [VS Code extension](../vscode/README.md).

## Install

```bash
npm install @playwright-repl/core
```

## Key Exports

### `EvaluateConnection`

Launch Chromium with the Dramaturg extension and execute commands via `serviceWorker.evaluate()`. No WebSocket bridge needed.

```typescript
import { EvaluateConnection, findExtensionPath } from '@playwright-repl/core';

const conn = new EvaluateConnection();
const { chromium } = await import('@playwright/test');
const extPath = findExtensionPath(import.meta.url);

await conn.start(extPath, { headed: true, chromium });

const result = await conn.run('snapshot');
console.log(result.text);

await conn.runScript('await page.title()', 'javascript');

await conn.close();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `start(extensionPath, opts)` | Launch Chromium with extension |
| `run(command, opts?)` | Execute a keyword command or JS expression |
| `runScript(script, language)` | Execute a multi-line script (`'pw'` or `'javascript'`) |
| `evaluate(fn, arg?)` | Run arbitrary code in the service worker |
| `connected` | `boolean` — whether the connection is active |
| `context` | Playwright browser context |
| `serviceWorker` | Extension service worker handle |
| `close()` | Close the browser |

### `BridgeServer`

WebSocket server for connecting to an existing Chrome with the Dramaturg extension installed. Used by CLI `--bridge` mode and MCP bridge mode.

```typescript
import { BridgeServer } from '@playwright-repl/core';

const bridge = new BridgeServer();
await bridge.start(9876);

await bridge.waitForConnection();
const result = await bridge.run('snapshot');

await bridge.close();
```

### `findExtensionPath`

Find the Dramaturg Chrome extension dist path. Checks monorepo first, then bundled npm location.

```typescript
import { findExtensionPath } from '@playwright-repl/core';

const extPath = findExtensionPath(import.meta.url);
// → '/path/to/packages/extension/dist' or null
```

---

### `parseInput`

Parse a raw command string into `ParsedArgs`.

```typescript
import { parseInput } from '@playwright-repl/core';

parseInput('click "Submit"');
// → { _: ['click', 'Submit'] }
```

---

## Types

```typescript
interface EngineResult {
  text?: string;     // Text output (accessibility tree, command result, error)
  image?: string;    // Base64 data URL (screenshot commands)
  isError?: boolean;
}

interface ParsedArgs {
  _: string[];       // Positional arguments
  [key: string]: unknown;  // Named flags
}
```

## File Structure

```
src/
├── evaluate-connection.ts # serviceWorker.evaluate() connection + findExtensionPath
├── bridge-server.ts       # WebSocket bridge server (BridgeServer)
├── parser.ts              # Command parsing, alias resolution, resolveArgs
├── page-scripts.ts        # Text locators + assertion helpers
├── completion-data.ts     # Autocomplete items for all commands
├── snapshot-parser.ts     # Snapshot tree parsing + ref-to-locator
├── filter.ts              # Response filtering
├── resolve.ts             # COMMANDS map, minimist re-export, version
├── colors.ts              # ANSI color helpers
├── types.ts               # Shared type definitions
└── index.ts               # Public exports
```
