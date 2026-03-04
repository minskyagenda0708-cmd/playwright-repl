# Migrate Extension from HTTP Server to playwright-crx (Approach A)

## Context

The current extension relies on an HTTP server (`playwright-repl --extension`) running on localhost:6781. This architecture is flaky — port conflicts, connection failures, 30-second timeouts, and a required external process. The `playwright-repl-crx` sister repo demonstrates a working replacement: use the `playwright-crx` library to execute Playwright commands directly inside the Chrome extension service worker, with `chrome.runtime.sendMessage` as IPC instead of HTTP fetch.

This plan ports that approach into the current extension while keeping the existing UI (CodeMirror editor, preferences page, tab switcher, recording, etc.) unchanged.

---

## Architecture After Migration

```
Panel UI  ──sendMessage({ type:'run', command })──►  background.ts
                                                        │
                                                        ▼
                                                  playwright-crx
                                                  crxApp.attach(tabId)
                                                        │
                                                        ▼
                                                  commands.ts / page-scripts.ts
                                                  page.click(), page.goto(), etc.
                                                        │
                                                        ▼
                                                  Chrome tab (direct CDP)
```

No external server. No HTTP. No port configuration.

---

## Step 1: Add dependency

**File**: `packages/extension/package.json`

Add to `dependencies`:
```json
"playwright-crx": "^0.15.0"
```

---

## Step 2: Copy source files from playwright-repl-crx

**New file**: `packages/extension/src/commands.ts`
Copy verbatim from `playwright-repl-crx/src/commands.ts`.
- Exports `parseReplCommand(input: string): ParseResult`
- Maps keyword commands (`goto`, `click`, `fill`, `verify-*`, `snapshot`, `screenshot`, `tabs`, `press`, `type`, `eval`, etc.) to `DirectExecution | TabOperation`
- Includes alias table (`c→click`, `f→fill`, `g→goto`, `vt→verify-text`, `ts→tab-select`, etc.)
- Supports chaining with `>>`

**New file**: `packages/extension/src/page-scripts.ts`
Copy verbatim from `playwright-repl-crx/src/page-scripts.ts`.
- All page functions used by commands.ts: `verifyText`, `verifyElement`, `verifyValue`, `verifyList`, `verifyTitle`, `verifyUrl`, `verifyNoText`, `verifyNoElement`, `actionByText`, `fillByText`, `selectByText`, `highlightByText/Selector`, `chainAction`, `goBack`, `goForward`, `gotoUrl`, `reloadPage`, `waitMs`, `getTitle`, `getUrl`, `evalCode`, `runCode`, `takeScreenshot`, `takeSnapshot`, `refAction`, `pressKey`, `typeText`, all storage/cookie helpers.

---

## Step 3: Add bridge.ts (replaces server.ts)

**New file**: `packages/extension/src/panel/lib/bridge.ts`

```ts
export type CommandResult = { text: string; isError: boolean; image?: string };

export async function executeCommand(command: string): Promise<CommandResult> {
  return chrome.runtime.sendMessage({ type: 'run', command });
}

export async function attachToTab(tabId: number): Promise<{ ok: boolean; url?: string; error?: string }> {
  return chrome.runtime.sendMessage({ type: 'attach', tabId });
}

export async function checkHealth(): Promise<{ ok: boolean }> {
  return chrome.runtime.sendMessage({ type: 'health' });
}

/**
 * Connects to the background service worker's recorder port with retry.
 * The port may not be ready immediately after record-start.
 */
export function connectWithRetry(maxRetries = 20, delay = 150): Promise<chrome.runtime.Port> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryConnect() {
      attempt++;
      const port = chrome.runtime.connect();
      let settled = false;
      port.onDisconnect.addListener(() => {
        chrome.runtime.lastError?.message;
        if (settled) return;
        settled = true;
        if (attempt < maxRetries) setTimeout(tryConnect, delay);
        else reject(new Error('Could not connect to recorder after retries'));
      });
      setTimeout(() => { if (!settled) { settled = true; resolve(port); } }, 100);
    }
    tryConnect();
  });
}
```

**Delete**: `packages/extension/src/panel/lib/server.ts`

---

## Step 3b: Add converter.ts

**New file**: `packages/extension/src/panel/lib/converter.ts`
Copy verbatim from `playwright-repl-crx/src/panel/lib/converter.ts`.
- `jsonlToRepl(jsonStr, isFirst)` — converts Playwright recorder JSONL actions to .pw commands
- `exportToPlaywright(cmds)` — converts .pw commands to a Playwright test file
- `tokenize(raw)` / `pwToPlaywright(cmd)` — helpers

Check if the current extension already has a `converter.ts` or equivalent export logic — if so, merge rather than replace.

---

## Step 4: Rewrite background.ts

**File**: `packages/extension/src/background.ts`

Fully rewrite. Remove all content-script recording logic. Replace with playwright-crx for both command execution and recording.

New additions:

```ts
import { crx, type CrxApplication } from 'playwright-crx';
import type { Page } from 'playwright-crx/test';
import { parseReplCommand } from './commands';

let crxApp: CrxApplication | null = null;
let currentPage: Page | null = null;
let activeTabId: number | null = null;

async function attachToTab(tabId: number): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    if (!crxApp) crxApp = await crx.start();
    if (activeTabId !== null && activeTabId !== tabId) {
      await crxApp.detach(activeTabId).catch(() => {});
    }
    currentPage = await crxApp.attach(tabId);
    activeTabId = tabId;
    return { ok: true, url: currentPage.url() };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Attach failed' };
  }
}

async function ensurePage(): Promise<Page> {
  if (currentPage) return currentPage;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const res = await attachToTab(tab.id);
  if (!res.ok) throw new Error(res.error ?? 'Attach failed');
  return currentPage!;
}

async function handleCommand(command: string): Promise<{ text: string; isError: boolean; image?: string }> {
  try {
    const parsed = parseReplCommand(command);
    if ('error' in parsed) return { text: parsed.error, isError: true };
    if ('help' in parsed) return { text: parsed.help, isError: false };
    if ('tabOp' in parsed) return handleTabOp(parsed.tabOp, parsed.tabArgs);
    const page = await ensurePage();
    const result = await Promise.race([
      parsed.fn(page, ...parsed.fnArgs),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 15000ms')), 15000)),
    ]);
    if (result?.__image) return { text: '', image: `data:${result.mimeType};base64,${result.__image}`, isError: false };
    return { text: result != null ? String(result) : 'Done', isError: false };
  } catch (e: any) {
    return { text: e?.message ?? 'Command failed', isError: true };
  }
}

async function handleTabOp(op: string, args: string[]): Promise<{ text: string; isError: boolean }> {
  if (op === 'list') {
    const tabs = await chrome.tabs.query({});
    const lines = tabs.map(t => `[${t.id}] ${t.title} — ${t.url}`);
    return { text: lines.join('\n'), isError: false };
  }
  if (op === 'select' && args[0]) {
    const tabId = parseInt(args[0], 10);
    await chrome.tabs.update(tabId, { active: true });
    const res = await attachToTab(tabId);
    return res.ok ? { text: `Switched to tab ${tabId}`, isError: false } : { text: res.error!, isError: true };
  }
  return { text: `Unknown tab operation: ${op}`, isError: true };
}
```

Replace recording functions (remove content script injection, add crx recorder):

```ts
async function startRecording(): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!crxApp) crxApp = await crx.start();
  const tabId = await getActiveTabId();
  if (tabId && crxApp.context().pages().length === 0) await attachToTab(tabId);
  const url = crxApp.context().pages()[0]?.url();
  crxApp.recorder.show({
    mode: 'recording',
    language: 'javascript',
    window: { type: 'sidepanel', url: 'panel/panel.html' },
  }).catch(() => {});
  return { ok: true, url };
}

async function stopRecording(): Promise<{ ok: boolean }> {
  await crxApp?.recorder.hide().catch(() => {});
  return { ok: true };
}
```

`chrome.runtime.onMessage` listener:
```ts
if (msg.type === 'run')          { handleCommand(msg.command).then(sendResponse); return true; }
if (msg.type === 'attach')       { attachToTab(msg.tabId).then(sendResponse); return true; }
if (msg.type === 'health')       { sendResponse({ ok: !!crxApp }); return false; }
if (msg.type === 'record-start') { startRecording().then(sendResponse); return true; }
if (msg.type === 'record-stop')  { stopRecording().then(sendResponse); return true; }
```

**Remove entirely from background.ts**:
- `injectRecorder()` / `chrome.scripting.executeScript`
- `tabs.onUpdated` re-injection listener
- `webNavigation.onCommitted` navigation listener
- `pw-recorded-command` message relay

---

## Step 5: Update run.ts

**File**: `packages/extension/src/panel/lib/run.ts`

- Change import: `from './server'` → `from './bridge'`
- Remove `setTabUrl` / `cachedTabUrl` (no longer needed — active tab is tracked in background.ts)
- Update error message to: `'Command failed. Try clicking Attach first.'`

---

## Step 6: Update reducer.ts

**File**: `packages/extension/src/panel/reducer.ts`

Port attach state and actions verbatim from `playwright-repl-crx/src/panel/reducer.ts`:

```ts
// New state fields (from crx reducer):
attachedUrl: string | null;  // null = not attached
isAttaching: boolean;        // true while attachToTab is in flight
```

New action types (from crx reducer):
- `{ type: 'ATTACH_START' }` → `{ ...state, isAttaching: true }`
- `{ type: 'ATTACH_SUCCESS', url: string }` → `{ ...state, isAttaching: false, attachedUrl: url }`
- `{ type: 'ATTACH_FAIL' }` → `{ ...state, isAttaching: false, attachedUrl: null }`
- `{ type: 'DETACH' }` → `{ ...state, attachedUrl: null }`

Also port `APPEND_EDITOR_CONTENT` if not already present (used by recording to append the initial `goto`).

---

## Step 7: Update App.tsx

**File**: `packages/extension/src/panel/App.tsx`

Replace `selectTab()` HTTP call with `attachToTab` bridge call:

```ts
import { attachToTab } from '@/lib/bridge';

async function doAttach(tabId: number) {
  dispatch({ type: 'ATTACH_START' });
  const res = await attachToTab(tabId);
  if (res.ok && res.url) dispatch({ type: 'ATTACH_SUCCESS', url: res.url });
  else dispatch({ type: 'ATTACH_FAIL', error: res.error ?? 'Attach failed' });
}

// Auto-attach on mount:
useEffect(() => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab?.id) doAttach(tab.id);
  });
  const onActivated = (info: chrome.tabs.TabActiveInfo) => doAttach(info.tabId);
  chrome.tabs.onActivated.addListener(onActivated);
  return () => chrome.tabs.onActivated.removeListener(onActivated);
}, []);
```

In popup mode (`?tabId=X`): call `doAttach(tabId)` on mount instead of the old HTTP attach.

Remove `setTabUrl` import from run.ts. Pass `state.isAttaching` and `state.attachedUrl` to `<Toolbar>`.

---

## Step 8: Update Toolbar.tsx

**File**: `packages/extension/src/panel/components/Toolbar.tsx`

Replace server health polling with attach state props, and replace content-script recording with crx port-based recording (pattern from `playwright-repl-crx/src/panel/components/Toolbar.tsx`):

```ts
// Props added/changed:
isAttaching?: boolean;
attachedUrl?: string;
// Props removed:
// serverPort, isConnected, onPortChange (all server-specific)
```

New recording logic (port-based):
```ts
import { connectWithRetry } from '@/lib/bridge';
import { jsonlToRepl } from '@/lib/converter';

const recorderPortRef = useRef<chrome.runtime.Port | null>(null);
const [isRecording, setIsRecording] = useState(false);

const handleRecordedSources = useCallback((sources: any[]) => {
  const source = sources.find(s => s.id === 'jsonl') || sources[0];
  if (!source?.actions?.length) return;
  const replLines = source.actions
    .map((a: string) => jsonlToRepl(a, false))
    .filter(Boolean) as string[];
  if (replLines.length > 0) dispatch({ type: 'EDIT_EDITOR_CONTENT', content: replLines.join('\n') });
}, [dispatch]);

async function handleRecord() {
  if (isRecording) {
    const port = recorderPortRef.current;
    recorderPortRef.current = null;
    setIsRecording(false);
    await chrome.runtime.sendMessage({ type: 'record-stop' }).catch(() => {});
    port?.disconnect();
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'record-start' });
  if (!result?.ok) { /* dispatch error */ return; }
  recorderPortRef.current = await connectWithRetry();
  setIsRecording(true);
  if (result.url && result.url !== 'about:blank') {
    dispatch({ type: 'APPEND_EDITOR_CONTENT', command: `goto "${result.url}"` });
  }
  recorderPortRef.current.onMessage.addListener((msg: any) => {
    if (msg.type === 'recorder' && msg.method === 'setSources') handleRecordedSources(msg.sources);
  });
  recorderPortRef.current.onDisconnect.addListener(() => {
    recorderPortRef.current = null;
    setIsRecording(false);
  });
}
```

Status indicator (replace server port UI):
- Dot: yellow when `isAttaching`, green when `attachedUrl`, grey otherwise
- Text: hostname from `attachedUrl`, or "Connecting…" / "Not attached"
- Keep tab switcher

---

## Files Summary

| Action | File |
|---|---|
| **Add** | `packages/extension/src/commands.ts` (copy from playwright-repl-crx) |
| **Add** | `packages/extension/src/page-scripts.ts` (copy from playwright-repl-crx) |
| **Add** | `packages/extension/src/panel/lib/bridge.ts` (with `connectWithRetry`) |
| **Add** | `packages/extension/src/panel/lib/converter.ts` (copy from playwright-repl-crx) |
| **Rewrite** | `packages/extension/src/background.ts` (crx command handling + crx recorder) |
| **Update** | `packages/extension/src/panel/lib/run.ts` (server → bridge import, remove setTabUrl) |
| **Update** | `packages/extension/src/panel/reducer.ts` (add ATTACH_* actions/state) |
| **Update** | `packages/extension/src/panel/App.tsx` (doAttach via bridge, not HTTP) |
| **Update** | `packages/extension/src/panel/components/Toolbar.tsx` (attach status + port-based recording) |
| **Update** | `packages/extension/package.json` (add playwright-crx dependency) |
| **Update** | `packages/extension/public/manifest.json` (remove `scripting`, `webNavigation` permissions) |
| **Delete** | `packages/extension/src/panel/lib/server.ts` |
| **Delete** | `packages/extension/src/content/recorder.ts` |

---

## Key Decisions

- **Recording**: Migrate to crx recorder (JSONL via Chrome port). Remove content script injection (`recorder.ts`), `webNavigation.onCommitted`, and `pw-recorded-command` relay entirely. Recording is now handled by `crxApp.recorder.show()` + port messages + `jsonlToRepl()`.
- **`checkHealth()`**: Not needed — the panel auto-attaches on mount and the attach result tells us if crx is running. Remove health polling from Toolbar entirely.
- **Tab list format**: After migration, `tab-list` returns `[tabId] title — url` using chrome tab IDs. `tab-select` takes a chrome tab ID. IDs are stable, not index-based.
- **Auto-attach**: Panel auto-attaches to the active tab on mount and on tab switch. No manual configuration.
- **CommandResult type**: Keep existing `{ text, isError, image? }` shape — ConsolePane, EditorPane, and run.ts need no structural changes.
- **`scripting` permission**: Removable — no longer injecting any content scripts.
- **`webNavigation` permission**: Removable — navigation events now come from the crx recorder.

---

## Verification

1. `npm install` in `packages/extension` — verify `playwright-crx` resolves
2. `npm run build` in `packages/extension` — verify 0 TypeScript errors
3. Load extension in Chrome (`chrome://extensions` → Load unpacked → `dist/`)
4. Open side panel — verify it auto-attaches and shows hostname in toolbar (no server needed)
5. Run `goto https://example.com` — verify navigation without external server
6. Run `click`, `fill`, `snapshot`, `screenshot` — verify commands execute
7. Run `tab-list` — verify chrome tabs shown in `[id] title — url` format
8. Start recording → interact with page → stop → verify commands appear in editor
9. `npm test` in `packages/extension` — update mocks in `background.test.ts` for new `run`/`attach`/`health` message types
