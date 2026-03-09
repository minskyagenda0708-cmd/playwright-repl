# Issue #72 — MCP Server for AI Browser Control

## Context

The ws-bridge (v0.12.0) lets a CLI connect to a running Chrome via WebSocket. This plan exposes that bridge as an **MCP server** so AI models (Claude Desktop, Claude Code) can directly operate the browser using playwright-repl commands — no extra glue code needed.

Architecture: MCP server starts a `BridgeServer`, Chrome extension connects out to it, AI calls `run_command("snapshot")` / `run_command("click Submit")` etc.

---

## New Package: `packages/mcp/`

`@playwright-repl/mcp` — publishable standalone binary `playwright-repl-mcp`.
pnpm workspace glob `packages/*` already covers it — no workspace config changes needed.

```
packages/mcp/
├── package.json
├── tsconfig.json          # no-emit (IDE / typecheck)
├── tsconfig.build.json    # composite, emits to dist/
└── src/
    └── index.ts           # MCP server entry point
```

---

## Files to Create

### 1. `packages/mcp/package.json`

```json
{
  "name": "@playwright-repl/mcp",
  "version": "0.12.0",
  "type": "module",
  "bin": { "playwright-repl-mcp": "./dist/index.js" },
  "main": "./dist/index.js",
  "files": ["dist/"],
  "scripts": { "build": "tsc --build tsconfig.build.json" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.10.0",
    "@playwright-repl/core": "workspace:*",
    "zod": "^3.24.0"
  }
}
```

### 2. `packages/mcp/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src"]
}
```

### 3. `packages/mcp/tsconfig.build.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "references": [{ "path": "../core/tsconfig.build.json" }],
  "include": ["src"]
}
```

### 4. `packages/mcp/src/index.ts`

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BridgeServer } from '@playwright-repl/core';

const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const port = portIdx !== -1
  ? parseInt(argv[portIdx + 1])
  : (process.env.BRIDGE_PORT ? parseInt(process.env.BRIDGE_PORT) : 9876);

const srv = new BridgeServer();
await srv.start(port);
console.error(`playwright-repl bridge listening on ws://localhost:${port}`);

srv.onConnect(() => console.error('Extension connected'));
srv.onDisconnect(() => console.error('Extension disconnected'));

const server = new McpServer({ name: 'playwright-repl', version: '0.12.0' });

server.tool(
  'run_command',
  {
    description:
      "Run a command in the connected Chrome browser. Supports three input modes:\n\n" +
      "1. KEYWORD (.pw) — playwright-repl commands:\n" +
      "   snapshot, goto <url>, click <text>, fill <label> <value>, press <key>,\n" +
      "   verify-text <text>, verify-no-text <text>, screenshot, scroll-down,\n" +
      "   check <label>, select <label> <value>, localstorage-list, localstorage-clear\n\n" +
      "2. PLAYWRIGHT — Playwright API (page.* / crxApp.*):\n" +
      "   await page.url(), await page.title(),\n" +
      "   await page.locator('button').count()\n\n" +
      "3. JAVASCRIPT — any JS expression evaluated in the browser:\n" +
      "   document.title, window.location.href,\n" +
      "   document.querySelectorAll('a').length\n\n" +
      "Always call snapshot first to understand the page before interacting. " +
      "Use screenshot to visually verify the current state.",
    inputSchema: {
      command: z.string().describe(
        "A keyword command ('snapshot', 'goto https://example.com', 'click Submit', " +
        "'fill \"Email\" user@example.com'), a Playwright expression " +
        "('await page.url()'), or a JavaScript expression ('document.title')"
      ),
    },
  },
  async ({ command }) => {
    if (!srv.connected) {
      return {
        content: [{ type: 'text' as const, text: 'Browser not connected. Open Chrome with the playwright-repl extension — it connects automatically.' }],
        isError: true,
      };
    }
    const result = await srv.run(command);
    if (result.image) {
      const [header, data] = result.image.split(',');
      const mimeType = (header.match(/data:(.*);base64/) ?? [])[1] ?? 'image/png';
      return { content: [{ type: 'image' as const, data, mimeType }] };
    }
    return {
      content: [{ type: 'text' as const, text: result.text || 'Done' }],
      isError: result.isError,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Files to Modify

### 5. Root `package.json` — add mcp to build script

Change the `build` script to include `packages/mcp/tsconfig.build.json`:

```
"build": "tsc --build packages/core/tsconfig.build.json packages/cli/tsconfig.build.json packages/mcp/tsconfig.build.json && pnpm --filter @playwright-repl/extension run build"
```

### 6. `packages/extension/src/panel/App.tsx` — read bridge port from `chrome.storage`

The WS connection lives in `App.tsx` (panel page), not `background.ts`. Currently `connect(port = 9876)` hardcodes the default. Make it read from `chrome.storage.sync` before connecting:

```typescript
// Replace: connect();
// With:
chrome.storage.sync.get({ bridgePort: 9876 }, ({ bridgePort }) => {
  connect(bridgePort as number);
});
```

### 7. Extension settings UI — bridge port input

Add a **Bridge Port** field to the extension's settings/options panel (wherever connection settings live). Persists to `chrome.storage.sync` under key `bridgePort`. Default `9876`.

- Input type `number`, label "Bridge Port"
- On change: `chrome.storage.sync.set({ bridgePort: value })`
- Show current connection status alongside (connected / disconnected)

### 8. `README.md` — add MCP Server section (after Bridge section), including Custom Port docs

```markdown
## MCP Server (AI Browser Agent)

`playwright-repl-mcp` exposes the bridge as an MCP tool so Claude and other AI models can directly operate the browser.

### Setup

1. Install the **playwright-repl extension** in Chrome
2. Install: `npm install -g @playwright-repl/mcp`
3. Add to your Claude Desktop config:

\`\`\`json
{
  "mcpServers": {
    "playwright-repl": {
      "command": "playwright-repl-mcp"
    }
  }
}
\`\`\`

4. Restart Claude Desktop → open Chrome → extension connects automatically
5. Ask Claude: *"Go to github.com/trending and list the top 5 repos"*

### Tool: `run_command`

| Command example | What it does |
|----------------|-------------|
| `snapshot` | Get current page accessibility tree |
| `goto https://example.com` | Navigate to URL |
| `click Submit` | Click by text/label |
| `fill "Email" user@example.com` | Type into input |
| `screenshot` | Capture page (returned as image to Claude) |
| `verify-text Welcome` | Assert text is visible |
| `scroll-down` | Scroll the page |

### Custom Port

Via CLI args:
\`\`\`json
{
  "mcpServers": {
    "playwright-repl": {
      "command": "playwright-repl-mcp",
      "args": ["--port", "9877"]
    }
  }
}
\`\`\`

Via environment variable:
\`\`\`json
{
  "mcpServers": {
    "playwright-repl": {
      "command": "playwright-repl-mcp",
      "env": { "BRIDGE_PORT": "9877" }
    }
  }
}
\`\`\`

`--port` takes precedence over `BRIDGE_PORT`. Default is `9876`.
```

---

## Verification

1. `pnpm install` — resolves `@modelcontextprotocol/sdk` and `zod` in `packages/mcp`
2. `pnpm run build` at root — `packages/mcp/dist/index.js` exists, no TS errors
3. `node packages/mcp/dist/index.js` — prints bridge listening message to stderr; process stays running
4. Open Chrome with extension → MCP server stderr shows `Extension connected`
5. Configure Claude Desktop with the MCP server → restart
6. In Claude: *"take a screenshot"* → Claude receives the image and describes it
7. In Claude: *"go to example.com and tell me the heading"* → Claude navigates, calls snapshot, reads heading
