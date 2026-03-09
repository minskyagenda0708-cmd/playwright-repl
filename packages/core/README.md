# @playwright-repl/core

Shared engine, parser, and utilities for the playwright-repl monorepo.

Used by [`playwright-repl`](../cli/README.md) (CLI) and [`@playwright-repl/mcp`](../mcp/README.md) (MCP server).

## Install

```bash
npm install @playwright-repl/core playwright
```

> Requires `playwright >= 1.59.0-alpha` (includes `lib/mcp/browser/` engine internals).

## Key Exports

### `Engine`

Runs Playwright's browser backend in-process. No daemon, no socket — commands execute directly.

```typescript
import { Engine } from '@playwright-repl/core';

const engine = new Engine();
await engine.start({ headed: true });

const result = await engine.run({ _: ['goto', 'https://example.com'] });
console.log(result.text);

const snap = await engine.run({ _: ['snapshot'] });
console.log(snap.text);

await engine.close();
```

**`EngineOpts`** (passed to `start()`):

| Option | Type | Description |
|--------|------|-------------|
| `headed` | `boolean` | Visible browser window |
| `browser` | `string` | `chrome`, `firefox`, `webkit`, `msedge` |
| `persistent` | `boolean` | Persistent browser profile |
| `profile` | `string` | Profile directory path |

**`EngineResult`**:

```typescript
interface EngineResult {
  text?: string;   // Text output (accessibility tree, command result, error message)
  image?: string;  // Base64 data URL for screenshot commands
  isError?: boolean;
}
```

---

### `BridgeServer`

WebSocket server that the Dramaturg Chrome extension connects to. Used by the CLI (`--bridge`) and MCP server.

```typescript
import { BridgeServer } from '@playwright-repl/core';

const bridge = new BridgeServer();
await bridge.start(9876);  // default port

bridge.onConnect(() => console.log('Extension connected'));
bridge.onDisconnect(() => console.log('Extension disconnected'));

await bridge.waitForConnection();

const result = await bridge.run('snapshot');
console.log(result.text);

await bridge.close();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `start(port?)` | Start WebSocket server (default port `9876`) |
| `run(command)` | Send a command string to the extension, returns `EngineResult` |
| `waitForConnection(timeoutMs?)` | Wait until extension connects (default 30s) |
| `onConnect(fn)` | Callback when extension connects |
| `onDisconnect(fn)` | Callback when extension disconnects |
| `connected` | `boolean` — whether extension is currently connected |
| `close()` | Shut down the server |

---

### `parseInput`

Parse a raw command string into `ParsedArgs`.

```typescript
import { parseInput } from '@playwright-repl/core';

parseInput('click "Submit"');
// → { _: ['click', 'Submit'] }

parseInput('fill "Email" user@example.com');
// → { _: ['fill', 'Email', 'user@example.com'] }

parseInput('snapshot');
// → { _: ['snapshot'] }
```

Returns `null` for unrecognized commands.

---

### `buildCompletionItems`

Autocomplete data for all `.pw` commands, with descriptions and usage hints.

```typescript
import { buildCompletionItems } from '@playwright-repl/core';

const items = buildCompletionItems();
// → [{ label: 'goto', detail: 'Navigate to a URL', ... }, ...]
```

---

## File Structure

```
src/
├── engine.ts           # In-process Playwright backend (Engine class)
├── bridge-server.ts    # WebSocket bridge server (BridgeServer class)
├── extension-server.ts # HTTP command server (CommandServer class — internal)
├── parser.ts           # Command parsing + alias resolution
├── page-scripts.ts     # Text locators + assertion helpers (serializable fns)
├── completion-data.ts  # Autocomplete items for all commands
├── resolve.ts          # COMMANDS map, minimist re-export, version
├── colors.ts           # ANSI color helpers
└── index.ts            # Public exports
```
