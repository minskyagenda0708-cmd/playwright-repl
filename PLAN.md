# Console Component — Step-by-Step Implementation

## Overview

Add a DevTools-style Console tab beside the Terminal, under the Editor pane.
Supports `.pw` commands, Playwright JS (`page.*`), and vanilla JS (`document.title`).
Object/array results shown with a custom expandable `ObjectTree` component (no extra dependency).

```
Toolbar
──────────────────────────────────
EditorPane (script editor)
──────────────────────────────────
[ Terminal | Console ]       [⊘]   ← ⊘ = clear, Console tab only
──────────────────────────────────
Terminal tab:              Console tab:
  ConsolePane              output entries
  CommandInput             > input
```

---

## Step 1 — Add `js-eval` to background.ts

In `packages/extension/src/background.ts`, inside the `chrome.runtime.onMessage` listener,
add alongside the existing `'run'`, `'attach'` cases:

```typescript
if (msg.type === 'js-eval') {
  if (!currentPage) {
    sendResponse({ isError: true, text: 'Not attached' });
    return false;
  }
  currentPage.evaluate((expr: string) => {
    return Function(`'use strict'; return (${expr})`)();
  }, msg.expr as string)
    .then(value => sendResponse({ isError: false, value }))
    .catch((e: any) => sendResponse({ isError: true, text: e?.message ?? String(e) }));
  return true;
}
```

---

## Step 2 — Add `jsEval` to bridge.ts

In `packages/extension/src/panel/lib/bridge.ts`, add:

```typescript
export async function jsEval(
  expr: string
): Promise<{ value?: unknown; text?: string; isError: boolean }> {
  return chrome.runtime.sendMessage({ type: 'js-eval', expr });
}
```

---

## Step 3 — Create `Console/types.ts`

New file: `packages/extension/src/panel/components/Console/types.ts`

```typescript
export type ConsoleMode = 'pw' | 'playwright' | 'js';

export interface ConsoleEntry {
  id: string;
  input: string;
  mode: ConsoleMode;
  status: 'pending' | 'done' | 'error';
  text?: string;       // pw / playwright result text
  value?: unknown;     // js result (for ObjectTree)
  image?: string;      // screenshot base64
  errorText?: string;
}

export interface ConsoleExecutors {
  pw: (cmd: string) => Promise<{ text: string; isError: boolean; image?: string }>;
  playwright: (code: string) => Promise<string>;
  js: (expr: string) => Promise<{ value?: unknown; text?: string; isError: boolean }>;
}

export interface ConsoleHandle {
  clear: () => void;
}

export interface ConsoleProps {
  executors: ConsoleExecutors;
  className?: string;
}
```

---

## Step 4 — Create `Console/useHistory.ts`

New file: `packages/extension/src/panel/components/Console/useHistory.ts`

```typescript
import { useRef } from 'react';

export function useHistory() {
  const stack = useRef<string[]>([]);
  const idx = useRef(-1);
  const draft = useRef('');

  function push(entry: string) {
    if (entry && entry !== stack.current[0]) {
      stack.current.unshift(entry);
    }
    idx.current = -1;
    draft.current = '';
  }

  function goBack(current: string): string | null {
    if (idx.current === -1) draft.current = current;
    if (idx.current < stack.current.length - 1) {
      idx.current++;
      return stack.current[idx.current];
    }
    return null;
  }

  function goForward(): string | null {
    if (idx.current > 0) {
      idx.current--;
      return stack.current[idx.current];
    }
    if (idx.current === 0) {
      idx.current = -1;
      return draft.current;
    }
    return null;
  }

  return { push, goBack, goForward };
}
```

---

## Step 5 — Create `Console/useConsole.ts`

New file: `packages/extension/src/panel/components/Console/useConsole.ts`

```typescript
import { useState } from 'react';
import type { ConsoleEntry, ConsoleExecutors, ConsoleMode } from './types';
import { COMMANDS } from '@/lib/commands';

function detectMode(input: string): ConsoleMode {
  const t = input.trim();
  if (/^(await\s+)?(page|crxApp|activeTabId|expect)\b/.test(t)) return 'playwright';
  const first = t.split(/\s+/)[0].toLowerCase();
  if (first in COMMANDS) return 'pw';
  return 'js';
}

export function useConsole(executors: ConsoleExecutors) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);

  function addEntry(entry: ConsoleEntry) {
    setEntries(prev => [...prev, entry]);
  }

  function updateEntry(id: string, patch: Partial<ConsoleEntry>) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  function clear() {
    setEntries([]);
  }

  async function execute(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    const mode = detectMode(trimmed);
    const id = Math.random().toString(36).slice(2);

    addEntry({ id, input: trimmed, mode, status: 'pending' });

    try {
      if (mode === 'pw') {
        const result = await executors.pw(trimmed);
        updateEntry(id, {
          status: result.isError ? 'error' : 'done',
          text: result.text,
          image: result.image,
          errorText: result.isError ? result.text : undefined,
        });
      } else if (mode === 'playwright') {
        const text = await executors.playwright(trimmed);
        updateEntry(id, { status: 'done', text });
      } else {
        const result = await executors.js(trimmed);
        if (result.isError) {
          updateEntry(id, { status: 'error', errorText: result.text });
        } else {
          updateEntry(id, { status: 'done', value: result.value });
        }
      }
    } catch (e: any) {
      updateEntry(id, { status: 'error', errorText: e?.message ?? String(e) });
    }
  }

  return { entries, execute, clear };
}
```

---

## Step 6 — Create `Console/ObjectTree.tsx`

New file: `packages/extension/src/panel/components/Console/ObjectTree.tsx`

No dependency — custom expandable tree, styled via CSS classes.

```tsx
import { useState } from 'react';

interface Props {
  data: unknown;
  depth?: number;
  label?: string;
}

export function ObjectTree({ data, depth = 0, label }: Props) {
  const [open, setOpen] = useState(depth < 2);

  const prefix = label !== undefined
    ? <><span className="ot-key">{label}</span><span className="ot-colon">: </span></>
    : null;

  // Primitives
  if (data === null)      return <span>{prefix}<span className="ot-null">null</span></span>;
  if (data === undefined) return <span>{prefix}<span className="ot-undefined">undefined</span></span>;
  if (typeof data === 'string')  return <span>{prefix}<span className="ot-string">"{data}"</span></span>;
  if (typeof data === 'number')  return <span>{prefix}<span className="ot-number">{data}</span></span>;
  if (typeof data === 'boolean') return <span>{prefix}<span className="ot-boolean">{String(data)}</span></span>;

  // Object / Array
  const isArray = Array.isArray(data);
  const keys = Object.keys(data as object);
  const summary = isArray ? `Array(${keys.length})` : 'Object';

  if (keys.length === 0) {
    return <span>{prefix}<span className="ot-empty">{isArray ? '[]' : '{}'}</span></span>;
  }

  return (
    <span className="ot-node">
      {prefix}
      <span className="ot-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▼' : '▶'} <span className="ot-summary">{summary}</span>
      </span>
      {open && (
        <div className="ot-children">
          {keys.map(k => (
            <div key={k} className="ot-row">
              <ObjectTree
                data={(data as Record<string, unknown>)[k]}
                depth={depth + 1}
                label={k}
              />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
```

CSS classes to style (you handle this):
- `.ot-key` — property name color (e.g. purple/blue)
- `.ot-colon` — muted
- `.ot-string` — red/orange
- `.ot-number` — blue
- `.ot-boolean` — blue
- `.ot-null`, `.ot-undefined` — gray italic
- `.ot-empty` — gray
- `.ot-toggle` — cursor pointer, user-select none
- `.ot-summary` — muted type label
- `.ot-children` — `padding-left: 12px`
- `.ot-row` — `display: flex`, wraps each property row

---

## Step 7 — Create `Console/ConsoleEntry.tsx`

New file: `packages/extension/src/panel/components/Console/ConsoleEntry.tsx`

```tsx
import { ObjectTree } from './ObjectTree';
import type { ConsoleEntry as Entry } from './types';

const MODE_LABEL: Record<string, string> = {
  pw: 'pw',
  playwright: 'js*',
  js: 'js',
};

export function ConsoleEntry({ entry }: { entry: Entry }) {
  return (
    <div className="console-entry" data-status={entry.status}>

      {/* Input line */}
      <div className="console-entry-input">
        <span className="console-prompt">&gt;</span>
        <span className="console-code">{entry.input}</span>
        <span className="console-mode-badge" data-mode={entry.mode}>
          {MODE_LABEL[entry.mode]}
        </span>
      </div>

      {/* Result */}
      {entry.status === 'pending' && (
        <div className="console-pending">…</div>
      )}

      {entry.status === 'done' && (
        <div className="console-result">
          {entry.image ? (
            <img src={entry.image} className="console-screenshot" alt="screenshot" />
          ) : entry.value !== undefined ? (
            <ObjectTree data={entry.value} />
          ) : (
            <span className="console-text">{entry.text}</span>
          )}
        </div>
      )}

      {entry.status === 'error' && (
        <div className="console-error">{entry.errorText}</div>
      )}

    </div>
  );
}
```

---

## Step 8 — Create `Console/ConsoleOutput.tsx`

New file: `packages/extension/src/panel/components/Console/ConsoleOutput.tsx`

```tsx
import { useEffect, useRef } from 'react';
import { ConsoleEntry } from './ConsoleEntry';
import type { ConsoleEntry as Entry } from './types';

export function ConsoleOutput({ entries }: { entries: Entry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [entries]);

  return (
    <div className="console-output">
      {entries.map(e => (
        <ConsoleEntry key={e.id} entry={e} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

---

## Step 9 — Create `Console/ConsoleInput.tsx`

New file: `packages/extension/src/panel/components/Console/ConsoleInput.tsx`

Plain `<textarea>` for Phase 1 — simple, no CodeMirror needed yet.

```tsx
import { useRef, forwardRef, useImperativeHandle, KeyboardEvent } from 'react';
import { useHistory } from './useHistory';

export interface ConsoleInputHandle {
  focus: () => void;
}

interface Props {
  onSubmit: (value: string) => void;
  onClear: () => void;
}

export const ConsoleInput = forwardRef<ConsoleInputHandle, Props>(
  function ConsoleInput({ onSubmit, onClear }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const hist = useHistory();

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      const el = textareaRef.current!;

      // Ctrl+L — clear
      if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        onClear();
        return;
      }

      // Enter — execute (Shift+Enter inserts newline)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const value = el.value.trim();
        if (!value) return;
        hist.push(value);
        onSubmit(value);
        el.value = '';
        el.style.height = 'auto';
        return;
      }

      // ArrowUp — history back (only when on first line)
      if (e.key === 'ArrowUp') {
        const beforeCursor = el.value.slice(0, el.selectionStart);
        if (!beforeCursor.includes('\n')) {
          e.preventDefault();
          const prev = hist.goBack(el.value);
          if (prev !== null) {
            el.value = prev;
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
            el.selectionStart = el.selectionEnd = prev.length;
          }
        }
        return;
      }

      // ArrowDown — history forward (only when on last line)
      if (e.key === 'ArrowDown') {
        const afterCursor = el.value.slice(el.selectionEnd);
        if (!afterCursor.includes('\n')) {
          e.preventDefault();
          const next = hist.goForward();
          if (next !== null) {
            el.value = next;
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
            el.selectionStart = el.selectionEnd = next.length;
          }
        }
        return;
      }
    }

    function handleInput() {
      const el = textareaRef.current!;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    return (
      <textarea
        ref={textareaRef}
        className="console-input-textarea"
        rows={1}
        spellCheck={false}
        placeholder="js expression, page.url(), or .pw command…"
        onKeyDown={handleKeyDown}
        onInput={handleInput}
      />
    );
  }
);
```

---

## Step 10 — Create `Console/index.tsx`

New file: `packages/extension/src/panel/components/Console/index.tsx`

```tsx
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useConsole } from './useConsole';
import { ConsoleOutput } from './ConsoleOutput';
import { ConsoleInput, type ConsoleInputHandle } from './ConsoleInput';
import type { ConsoleHandle, ConsoleProps } from './types';

export { type ConsoleHandle } from './types';

export const Console = forwardRef<ConsoleHandle, ConsoleProps>(
  function Console({ executors, className }, ref) {
    const { entries, execute, clear } = useConsole(executors);
    const inputRef = useRef<ConsoleInputHandle>(null);

    useImperativeHandle(ref, () => ({ clear }));

    return (
      <div className={`console-pane ${className ?? ''}`} data-testid="console-pane">
        <ConsoleOutput entries={entries} />
        <div className="console-input-row">
          <span className="console-prompt">&gt;</span>
          <ConsoleInput ref={inputRef} onSubmit={execute} onClear={clear} />
        </div>
      </div>
    );
  }
);
```

---

## Step 11 — Update App.tsx

In `packages/extension/src/panel/App.tsx`:

**Add imports:**
```typescript
import { useState, useRef } from 'react';
import { Console, type ConsoleHandle } from '@/components/Console';
import { jsEval } from '@/lib/bridge';
import { runCodeInSandbox } from '@/lib/sandbox-runner';
```

**Add inside component:**
```typescript
const [bottomTab, setBottomTab] = useState<'terminal' | 'console'>('terminal');
const consoleRef = useRef<ConsoleHandle>(null);
```

**Add tab bar** between `<CodeMirrorEditorPane>` and `<ConsolePane>`:
```tsx
<div className="bottom-tab-bar">
  <button
    data-active={bottomTab === 'terminal'}
    onClick={() => setBottomTab('terminal')}
  >Terminal</button>
  <button
    data-active={bottomTab === 'console'}
    onClick={() => setBottomTab('console')}
  >Console</button>
  <div className="bottom-tab-spacer" />
  {bottomTab === 'console' && (
    <button
      className="console-clear-btn"
      onClick={() => consoleRef.current?.clear()}
      title="Clear console (Ctrl+L)"
    >⊘</button>
  )}
</div>
```

**Wrap bottom pane** in a conditional:
```tsx
{bottomTab === 'terminal' ? (
  <>
    <ConsolePane ... />   {/* existing, unchanged */}
    <CommandInput ... />  {/* existing, unchanged */}
  </>
) : (
  <Console
    ref={consoleRef}
    executors={{
      pw: cmd => executeCommand(cmd),
      playwright: code => runCodeInSandbox(code),
      js: expr => jsEval(expr),
    }}
  />
)}
```

---

## Step 12 — Add CSS (you handle styling)

Classes to style:
- `.bottom-tab-bar` — flex row, border-top or border-bottom, background matches toolbar
- `.bottom-tab-bar button` — tab style; `[data-active="true"]` = active tab indicator
- `.bottom-tab-spacer` — `flex: 1`
- `.console-clear-btn` — small icon button, right side
- `.console-pane` — `display: flex; flex-direction: column; height: 100%; overflow: hidden`
- `.console-output` — `flex: 1; overflow-y: auto; padding: 4px 8px`
- `.console-entry` — padding bottom, border-bottom (subtle)
- `.console-entry-input` — flex row, gap, monospace
- `.console-prompt` — muted color
- `.console-code` — flex 1, monospace
- `.console-mode-badge` — small pill; `[data-mode="pw"]` green, `[data-mode="js"]` blue, `[data-mode="playwright"]` purple
- `.console-result` — `padding-left: 16px; color: var(--text-default)`
- `.console-error` — `padding-left: 16px; color: var(--color-error)`
- `.console-input-row` — flex row, align-center, border-top, padding 4px 8px
- `.console-input-textarea` — flex 1, no border, no resize, background transparent, monospace, color inherit, `max-height: 120px`
- ObjectTree classes: `.ot-key`, `.ot-string`, `.ot-number`, `.ot-boolean`, `.ot-null`, `.ot-undefined`, `.ot-toggle`, `.ot-children`, `.ot-row`

---

## Step 13 — Build and test

```bash
cd packages/extension
pnpm run build        # check for TypeScript errors
```

Load in Chrome, switch to Console tab, test:
- `document.title` → string `"Page Title"`
- `[1, 2, 3]` → `▶ Array(3)` — click to expand → `0: 1`, `1: 2`, `2: 3`
- `{ a: 1, b: { c: 2 } }` → expandable nested object
- `page.url()` → URL string
- `goto https://example.com` → pw success text
- `screenshot` → image inline
- `Ctrl+L` or ⊘ button → clears output
- `ArrowUp` / `ArrowDown` → navigates history
- `Shift+Enter` → inserts newline in textarea
