# Recording & Locator Picker Plan

Issue: #333

## Current State

The Chrome extension already has full recording and picker implementations:
- `content/recorder.ts` — captures clicks, types, navigations via event listeners
- `content/picker.ts` — highlights elements on hover, captures on click
- `content/locator.ts` — generates locators (getByRole, getByText, etc.)
- `panel/lib/pick-info.ts` — builds full pick results with assertions

These communicate via `chrome.runtime.sendMessage` to the panel UI.

## The Challenge: Streaming

Recording sends **continuous events** as the user interacts with the browser:
```
User clicks button → { type: 'recorded-action', action: { pw: 'click button "Submit"', js: 'await page.getByRole(...).click()' } }
User types text    → { type: 'recorded-action', action: { pw: 'fill textbox "hello"', js: 'await page.locator(...).fill("hello")' } }
User types more    → { type: 'recorded-fill-update', action: { pw: 'fill textbox "hello world"', js: '...' } }
```

But BridgeServer is **request/response only** — client sends request, server sends one response.
It cannot push events from extension to VS Code.

## Solution: Add Event Channel to Bridge

Extend BridgeServer to support server-initiated events:

```
BridgeServer (existing):
  Client ──request──→ Server ──response──→ Client

BridgeServer (extended):
  Client ──request──→ Server ──response──→ Client
  Client ←──event─── Server                        ← NEW
```

### Implementation

**BridgeServer** — add `onEvent` callback:
```typescript
// In bridge-server.ts
private _onEvent?: (event: { type: string; data: unknown }) => void;
onEvent(fn: (event: { type: string; data: unknown }) => void) { this._onEvent = fn; }
```

**Offscreen document** — forward recording/picker events:
```typescript
// In offscreen.ts — listen for events from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'recorded-action' || msg.type === 'recorded-fill-update' || msg.type === 'element-picked-raw') {
    // Forward to BridgeServer as an event (no request ID)
    ws.send(JSON.stringify({ _event: true, ...msg }));
  }
});
```

**BridgeServer** — handle incoming events:
```typescript
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg._event) {
    // Server-initiated event from extension
    this._onEvent?.(msg);
    return;
  }
  // Normal request/response handling
  this.pending.get(msg.id)?.(msg);
});
```

## Recording Flow (VS Code)

### Smart Cursor Detection

Before recording starts, detect cursor position in the active editor:

**Cursor outside test function** (or no active editor / not a .spec.ts file):
```typescript
// Generate test template, insert at cursor:
test('new test', async ({ page }) => {
  await page.goto('<current browser URL>');
  |  ← cursor positioned here, recording starts
});
```

**Cursor inside test function**:
```typescript
test('existing test', async ({ page }) => {
  await page.goto('https://example.com');
  await page.click('.login');
  |  ← cursor is here, recording inserts below
});
```

Detection logic:
1. Walk backward from cursor line looking for `test(` or `test.describe(`
2. Track brace depth — if cursor is inside a `test()` callback, we're "inside"
3. If inside → record at cursor with current indentation
4. If outside → create template, position cursor inside, then record

### Full Flow

```
1. User: Cmd+Shift+P → "Playwright IDE: Start Recording"

2. VS Code detects cursor context:
   a. OUTSIDE test fn → insert test template + page.goto(currentUrl)
   b. INSIDE test fn → just note the cursor position + indentation

3. VS Code → bridge.run('record-start')
   → extension injects recorder.ts into page
   → returns { ok: true, url: '...' }

4. User interacts with browser:
   Click button → extension sends { type: 'recorded-action', action: { js: '...' } }
   → offscreen forwards as event over WebSocket
   → BridgeServer._onEvent fires
   → VS Code inserts `await page.getByRole('button').click();` at cursor

5. User types in field → recorded-action (fill start)
   → VS Code inserts `await page.locator('#email').fill('h');`
   Types more → recorded-fill-update
   → VS Code replaces last inserted line with `await page.locator('#email').fill('hello');`

6. User: Cmd+Shift+P → "Playwright IDE: Stop Recording"
   → bridge.run('record-stop')
   → extension removes recorder
```

## Locator Picker Flow (VS Code)

```
1. User: Cmd+Shift+P → "Playwright IDE: Pick Locator"
2. VS Code → bridge.run('pick-start')
   → extension injects picker.ts (hover overlay)

3. User clicks element:
   → { type: 'element-picked-raw', pickId, info }
   → offscreen forwards as event
   → BridgeServer._onEvent fires
   → VS Code receives pick result
   → Inserts `page.getByRole('button', { name: 'Submit' })` at cursor
   → Auto-stops picking
```

## Components to Build

### 1. Bridge Event Channel (packages/core)
- Add `_event` message handling to BridgeServer
- Add `onEvent` callback registration
- Update offscreen.ts to forward recording/picker events

### 2. VS Code Commands (packages/vscode)
- `playwright-ide.startRecording` — starts recording, handles events
- `playwright-ide.stopRecording` — stops recording
- `playwright-ide.pickLocator` — starts picker, handles one event
- Status bar item showing recording/picking state

### 3. Editor Integration (packages/vscode)
- `insertAtCursor(text)` — insert text at active editor cursor
- `replaceLastInsert(text)` — replace last inserted line (fill updates)
- Auto-indent based on surrounding code
- JS mode (generates `await page.getByRole(...)` expressions)

## Message Types (already implemented in extension)

| Message | Direction | Purpose |
|---------|-----------|---------|
| `record-start` | VS Code → ext | Start recording |
| `record-stop` | VS Code → ext | Stop recording |
| `recorded-action` | ext → VS Code | New recorded action |
| `recorded-fill-update` | ext → VS Code | Update last fill text |
| `pick-start` | VS Code → ext | Start element picker |
| `pick-stop` | VS Code → ext | Stop picker |
| `element-picked-raw` | ext → VS Code | Element picked |

## What We Reuse

- `content/recorder.ts` — action capture (no changes needed)
- `content/picker.ts` — element picker (no changes needed)
- `content/locator.ts` — locator generation (no changes needed)
- Recording start/stop in background.ts (no changes needed)
- Picker start/stop in background.ts (no changes needed)

## What We Build

- Bridge event channel (core)
- Offscreen event forwarding (extension)
- VS Code commands + editor integration (vscode)
- Status bar indicator (vscode)
