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
try {
    await srv.start(port);
} catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
        console.error(`Error: port ${port} is already in use. Another playwright-repl bridge or MCP inspector may be running. Stop it and restart Claude Desktop.`);
        process.exit(1);
    }
    throw err;
}
console.error(`playwright-repl bridge listening on ws://localhost:${port}`);

srv.onConnect(() => console.error('Extension connected'));
srv.onDisconnect(() => console.error('Extension disconnected'));

const RUN_COMMAND_INPUT_DESCRIPTION = `\
A keyword command ('snapshot', 'goto https://example.com', 'click Submit', \
'fill "Email" user@example.com'), a Playwright expression \
('await page.url()'), or a JavaScript expression ('document.title')`;

const RUN_COMMAND_DESCRIPTION = `\
Run a command in the connected Chrome browser. Supports three input modes:

1. KEYWORD (.pw) — playwright-repl commands:
   snapshot, goto <url>, click <text>, fill <label> <value>, press <key>,
   verify-text <text>, verify-no-text <text>, screenshot, scroll-down,
   check <label>, select <label> <value>, localstorage-list, localstorage-clear

2. PLAYWRIGHT — Playwright API (page.* / crxApp.*):
   await page.url(), await page.title(),
   await page.locator('button').count()

3. JAVASCRIPT — any JS expression evaluated in the browser:
   document.title, window.location.href,
   document.querySelectorAll('a').length

Use snapshot to understand the page structure before interacting. Use screenshot to visually verify the current state.`;

const server = new McpServer({ name: 'playwright-repl', version: '0.12.0' });

server.registerTool(
    'run_command',
    {
        description: RUN_COMMAND_DESCRIPTION,
        inputSchema: {
            command: z.string().describe(RUN_COMMAND_INPUT_DESCRIPTION),
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