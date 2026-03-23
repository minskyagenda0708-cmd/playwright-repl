# Playwright IDE — UI Vision

## Full Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ VS Code                                                         │
│                                                                 │
│ ┌─ Activity Bar ─┐ ┌─ Editor ──────────────────────────────────┐│
│ │                │ │ login.spec.ts                              ││
│ │  📁 Explorer   │ │                                            ││
│ │  🔍 Search     │ │  test('login', async ({ page }) => {      ││
│ │  🧪 Testing ◀  │ │    await page.goto('/login');         ▶ ▷ ││
│ │  🎭 Playwright │ │    await page.fill('#email', 'admin');    ││
│ │                │ │    await page.click('button');             ││
│ │                │ │    await expect(page).toHaveURL('/dash');  ││
│ │                │ │  });                                       ││
│ │                │ │                                            ││
│ └────────────────┘ └────────────────────────────────────────────┘│
│                                                                 │
│ ┌─ Playwright Sidebar ──────────────────────────────────────────┐│
│ │                                                               ││
│ │ BROWSER           [Chrome ▾]  [🔴 Record] [🎯 Pick]          ││
│ │ ─────────────────────────────────────────────────             ││
│ │ Status: Connected (headed)                                    ││
│ │ URL: https://myapp.com/login                                  ││
│ │                                                               ││
│ │ TESTS                                                         ││
│ │ ─────────────────────────────────────────────────             ││
│ │ ▶ login.spec.ts                                               ││
│ │   ✓ login (26ms)                    [▶] [🔴] [🎯]            ││
│ │   ✗ logout (5012ms)                 [▶] [🔴] [🎯]            ││
│ │ ▶ dashboard.spec.ts                                           ││
│ │   - settings (skipped)                                        ││
│ │                                                               ││
│ │ REPL                                                          ││
│ │ ─────────────────────────────────────────────────             ││
│ │ > await page.title()                                          ││
│ │ 'My App - Login'                                              ││
│ │ > _                                                           ││
│ │                                                               ││
│ └───────────────────────────────────────────────────────────────┘│
│                                                                 │
│ ┌─ Status Bar ──────────────────────────────────────────────────┐│
│ │ 🎭 Connected  │  ⏺ Record  │  🎯 Pick  │  ✓ 3 passed       ││
│ └───────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Editor Gutter Actions
Icons next to each test line:
- ▶ Run this test
- ▷ Debug this test
- 🔴 Record from here (append actions at this position)
- 🎯 Pick locator at cursor

### Playwright Sidebar (Custom View)
A dedicated sidebar with three sections:

**Browser Controls:**
- Launch/Stop browser
- Browser selector (Chrome, Chromium, Edge)
- Headed/Headless toggle
- Record and Pick buttons
- Connection status + current URL

**Test Tree:**
- File → describe → test hierarchy
- Inline run/record/pick buttons per test
- Pass/fail/skip status with timing
- Click to jump to source

**REPL:**
- Embedded interactive REPL (not a separate terminal)
- Command history, keyword commands, JavaScript
- Same bridge mode execution

### Status Bar
Always visible at bottom:
- 🎭 Connection status (Connected/Disconnected)
- ⏺ Record toggle (Record / Stop Recording)
- 🎯 Pick toggle (Pick Locator / Stop Picking)
- Test results summary (✓ 3 passed, ✗ 1 failed)

## Flows

### Pick Locator (full vision)
```
1. Click 🎯 Pick → browser enters pick mode
2. Hover over elements → highlight in browser
3. Status bar shows live locator preview:
   "page.getByRole('button', { name: 'Submit' })"
4. Click element → VS Code quick pick menu:
   ┌──────────────────────────────────────┐
   │ page.getByRole('button', { name })   │
   ├──────────────────────────────────────┤
   │ ▸ Click                              │
   │ ▸ Fill...                            │
   │ ▸ Assert visible                     │
   │ ▸ Assert text                        │
   │ ▸ Copy locator                       │
   │ ▸ Highlight                          │
   └──────────────────────────────────────┘
5. Select action → code inserted at cursor
6. Stays in pick mode until Escape
```

### Record (full vision)
```
1. Click 🔴 Record
2. Cursor detection:
   - Outside test fn → generate template
   - Inside test fn → record at cursor position
3. Insert page.goto(currentUrl) as first action
4. Every browser action → inserts code line in editor
5. Mid-recording: click 🎯 to add assertion at current position
6. Click ⏹ Stop → recording ends, test is complete
7. Click ▶ Run → auto-stops recording, runs the test
```

### Run Test
```
1. Click ▶ on a test (gutter, sidebar, or command palette)
2. Auto-launches browser if not running
3. Bundles .spec.ts with esbuild → sends through bridge
4. playwright-crx executes in-process (35x speed)
5. Results mapped to Test Explorer (✓/✗ in gutter + sidebar)
6. Failed tests show inline error messages
```

## Evolution Path

| Version | Feature | Status |
|---------|---------|--------|
| V1 | Bridge mode REPL | ✅ Merged (#327) |
| V1 | Test runner (esbuild + bridge) | ✅ Merged (#330) |
| V1 | Test Explorer (tree + run) | ✅ Merged (#332) |
| V1 | Recording (stream to editor) | 🔄 PR #335 |
| V2 | Locator picker (simple insert) | Next |
| V2 | Recorder locator quality | #334 |
| V2 | Persistent pick mode | Future |
| V3 | Live locator preview (status bar) | Future |
| V3 | Pick → action menu (click/fill/assert) | Future |
| V3 | Playwright sidebar (custom view) | Future |
| V3 | Editor gutter actions (▶ 🔴 🎯) | Future |
| V4 | Embedded REPL in sidebar | Future |
| V4 | Inline locator widget | Future |
| V4 | Mid-recording assertions | Future |
