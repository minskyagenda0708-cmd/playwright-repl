# Stagecraft Agent Guide

Instructions for AI agents using playwright-repl and stagecraft to record and run skills.

## Setup

You need two terminals:

**Terminal 1** — start the playwright-repl server with your logged-in Chrome session:
```bash
playwright-repl --http
```

**Terminal 2** — run stagecraft commands:
```bash
stagecraft list
stagecraft run <skill-name> --http
```

## Recording a New Skill

### Step 1: Navigate the site manually in Chrome and log in

Skills require authentication (Rogers, Bell, etc.). Log in manually in Chrome before recording. The bridge connects to your existing session — no credentials needed in the script.

### Step 2: Start recording

Via MCP `run_command`:
```
start-recording skills/rogers/my-new-skill.pw
```

### Step 3: Take a snapshot before each action

Refs (e1, e5, etc.) are only stable within a session. The recorder converts them to stable text locators (`button "Submit"`) using the most recent snapshot. Always snapshot before clicking refs:

```
snapshot
click e5          ← recorded as: click button "View your bill"
snapshot
click e12         ← recorded as: click link "Billing history"
```

If you skip `snapshot`, the ref stays as-is (e5) and won't work in future sessions.

### Step 4: Stop recording

```
stop-recording
```

Output: `Recording saved: skills/rogers/my-new-skill.pw (7 commands)`

### Step 5: Write the SKILL.md

Create `skills/rogers/my-new-skill/SKILL.md`:

```markdown
---
name: my-new-skill
description: Short description of what this skill does
category: tax/bills/telecom
preconditions: Must be logged into rogers.com (use bridge mode)
parameters:
  - billing_period: billing period label, e.g. "January 24, 2026"
output: description of what the skill produces
---

# My New Skill

Longer description with context and notes for the agent.
```

### Step 6: Replay to verify

```bash
stagecraft run my-new-skill --http -v billing_period="January 24, 2026"
```

Or via MCP:
```
run_script("replay skills/rogers/my-new-skill.pw", language="pw")
```

## Anatomy of a .pw Skill File

```pw
# Rogers bill download
# Navigate to MyRogers billing page and download bill PDFs

goto https://www.rogers.com/consumer/self-serve/overview
click "View your bill" --exact
click "Save PDF"
check "{{billing_period}}"
download-as {{filename}}
click "Download bills"
```

- Lines starting with `#` are comments
- `{{variable}}` placeholders are substituted at run time
- Text locators (`"View your bill"`) are stable across sessions
- Ref locators (`e5`) are session-only — avoid them in saved skills

## For Complex Logic: Use a .js Skill

When you need loops, conditionals, downloads with `saveAs`, or multi-step data extraction — write a `.js` skill alongside the `.pw` file.

The `.js` file is a top-level `await`-capable script with `page`, `context`, and `expect` in scope.

```js
// skills/rogers/download-bill.js
const periods = JSON.parse('{{periods}}');
const savePath = '{{savePath}}';

await page.goto('https://www.rogers.com/consumer/self-serve/overview');
// ...

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByText('Download bills').click(),
]);

if (savePath) {
  await download.saveAs(savePath);
  savePath;
} else {
  download.suggestedFilename();
}
```

Run via:
```bash
stagecraft run download-rogers-bill --http \
  --variable periods='["January 24, 2026"]' \
  --variable savePath="/home/user/tax/rogers-2026-01.pdf"
```

## Skill Directory Layout

```
skills/
└── rogers/
    ├── SKILL.md           # metadata (required)
    ├── download-bill.pw   # keyword script (simple flows)
    └── download-bill.js   # Playwright JS (complex logic, downloads)
```

Add your own skills to `~/.stagecraft/skills/` — they appear in `stagecraft list` marked `[user]` and override builtin skills of the same name.

## Available Commands Reference

Run `help` via MCP to get the full list. Key commands for recording flows:

| Command | Purpose |
|---------|---------|
| `goto <url>` | Navigate |
| `snapshot` | Get accessibility tree (required before using refs) |
| `click <text\|ref>` | Click element |
| `fill <text\|ref> <value>` | Fill input |
| `check <text\|ref>` | Check checkbox |
| `select <text\|ref> <value>` | Select dropdown option |
| `verify-text <text>` | Assert text is present |
| `download-as <filename>` | Set filename for next browser download |
| `start-recording [file]` | Begin recording to .pw file |
| `stop-recording` | Save recording |
| `pause-recording` | Pause/resume |
| `discard-recording` | Abandon recording |
