/**
 * Command parser — transforms human input into executable commands.
 *
 * Pipeline: tokenize → alias → resolveArgs → DirectExecution or TabOperation
 *
 * resolveArgs returns either:
 *   - DirectExecution { fn, fnArgs } — called directly with the Playwright page object
 *   - TabOperation { tabOp, tabArgs } — handled by background.ts via chrome.tabs APIs
 */

import {
  verifyText, verifyElement, verifyValue, verifyList,
  verifyTitle, verifyUrl, verifyNoText, verifyNoElement,
  actionByText, fillByText, selectByText, checkByText, uncheckByText,
  highlightByText, highlightBySelector, chainAction, goBack, goForward,
  gotoUrl, reloadPage, waitMs, getTitle, getUrl,
  evalCode, runCode, takeScreenshot, takeSnapshot,
  refAction, pressKey, typeText,
  localStorageGet, localStorageSet, localStorageDelete, localStorageClear, localStorageList,
  sessionStorageGet, sessionStorageSet, sessionStorageDelete, sessionStorageClear, sessionStorageList,
  cookieList, cookieGet, cookieClear,
} from './page-scripts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  _: string[];
  nth?: string | number;
  [key: string]: unknown;
}

export interface DirectExecution {
  fn: (...args: any[]) => Promise<any>;
  fnArgs: unknown[];
}

export interface TabOperation {
  tabOp: string;
  tabArgs: Record<string, unknown>;
}

export type ParseResult =
  | DirectExecution
  | TabOperation
  | { help: string }
  | { error: string };

type PageScriptFn = (...args: any[]) => Promise<any>;

function isDirect(result: ParsedArgs | DirectExecution | TabOperation): result is DirectExecution {
  return 'fn' in result && typeof (result as DirectExecution).fn === 'function';
}

// ─── Command aliases ────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  // Navigation
  'o':    'open',
  'g':    'goto',
  'go':   'goto',
  'back': 'go-back',
  'fwd':  'go-forward',
  'r':    'reload',

  // Interaction
  'c':    'click',
  'dc':   'dblclick',
  't':    'type',
  'f':    'fill',
  'h':    'hover',
  'p':    'press',
  'sel':  'select',
  'chk':  'check',
  'unchk':'uncheck',

  // Inspection
  'hl':   'highlight',
  's':    'snapshot',
  'snap': 'snapshot',
  'ss':   'screenshot',
  'e':    'eval',
  'con':  'console',
  'net':  'network',

  // Tabs
  'tl':   'tab-list',
  'tn':   'tab-new',
  'tc':   'tab-close',
  'ts':   'tab-select',

  // Assertions
  'v':    'verify',
  'vt':   'verify-text',
  've':   'verify-element',
  'vv':   'verify-value',
  'vl':   'verify-list',
};

// ─── Known boolean options ──────────────────────────────────────────────────

const BOOLEAN_OPTIONS = new Set([
  'headed', 'persistent', 'extension', 'submit', 'clear',
  'fullPage', 'includeStatic',
]);

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/**
 * Tokenize input respecting quoted strings.
 * "fill e7 'hello world'" → ["fill", "e7", "hello world"]
 */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ─── Parse Input ────────────────────────────────────────────────────────────

// Commands where everything after the keyword is a single raw argument
const RAW_COMMANDS = new Set(['run-code', 'eval']);

/**
 * Parse a REPL input line into a ParsedArgs object.
 * Handles tokenization, alias resolution, and option extraction.
 */
function parseInput(line: string): ParsedArgs | null {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;

  // Resolve alias
  const cmd = tokens[0].toLowerCase();
  if (ALIASES[cmd]) tokens[0] = ALIASES[cmd];
  else tokens[0] = cmd;

  // For run-code / eval, preserve the rest of the line as a single raw string
  if (RAW_COMMANDS.has(tokens[0])) {
    const cmdLen = line.match(/^\s*\S+/)![0].length;
    const rest = line.slice(cmdLen).trim();
    return rest ? { _: [tokens[0], rest] } : { _: [tokens[0]] };
  }

  // Simple option extraction (--key value or --flag)
  const positional: string[] = [];
  const opts: Record<string, unknown> = {};
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].startsWith('--')) {
      const key = tokens[i].slice(2);
      if (BOOLEAN_OPTIONS.has(key)) {
        opts[key] = true;
        i++;
      } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        opts[key] = tokens[i + 1];
        i += 2;
      } else {
        opts[key] = true;
        i++;
      }
    } else {
      positional.push(tokens[i]);
      i++;
    }
  }

  return { _: positional, ...opts } as ParsedArgs;
}

// ─── Resolve Args ────────────────────────────────────────────────────────────

/**
 * Map parsed args to DirectExecution or TabOperation.
 * Returns null if no mapping found (→ error).
 */
function resolveArgs(args: ParsedArgs): ParsedArgs | DirectExecution | TabOperation {
  const cmdName = args._[0];

  // ── Verify unified ──────────────────────────────────────────
  if (cmdName === 'verify') {
    const subType = args._[1];
    const rest = args._.slice(2);
    if (subType === 'title' && rest.length > 0)
      return { fn: verifyTitle as PageScriptFn, fnArgs: [rest.join(' ')] };
    if (subType === 'url' && rest.length > 0)
      return { fn: verifyUrl as PageScriptFn, fnArgs: [rest.join(' ')] };
    if (subType === 'text' && rest.length > 0)
      return { fn: verifyText as PageScriptFn, fnArgs: [rest.join(' ')] };
    if (subType === 'no-text' && rest.length > 0)
      return { fn: verifyNoText as PageScriptFn, fnArgs: [rest.join(' ')] };
    if (subType === 'element' && rest.length >= 2)
      return { fn: verifyElement as PageScriptFn, fnArgs: [rest[0], rest.slice(1).join(' ')] };
    if (subType === 'no-element' && rest.length >= 2)
      return { fn: verifyNoElement as PageScriptFn, fnArgs: [rest[0], rest.slice(1).join(' ')] };
    if (subType === 'value' && rest.length >= 2)
      return { fn: verifyValue as PageScriptFn, fnArgs: [rest[0], rest.slice(1).join(' ')] };
    if (subType === 'list' && rest.length >= 2)
      return { fn: verifyList as PageScriptFn, fnArgs: [rest[0], rest.slice(1)] };
  }

  // ── Legacy verify-* commands ────────────────────────────────
  const verifyFns: Record<string, PageScriptFn> = {
    'verify-text': verifyText as PageScriptFn,
    'verify-element': verifyElement as PageScriptFn,
    'verify-value': verifyValue as PageScriptFn,
    'verify-list': verifyList as PageScriptFn,
    'verify-title': verifyTitle as PageScriptFn,
    'verify-url': verifyUrl as PageScriptFn,
    'verify-no-text': verifyNoText as PageScriptFn,
    'verify-no-element': verifyNoElement as PageScriptFn,
  };
  if (verifyFns[cmdName]) {
    const pos = args._.slice(1);
    const fn = verifyFns[cmdName];
    if (cmdName === 'verify-text' || cmdName === 'verify-no-text' || cmdName === 'verify-title' || cmdName === 'verify-url') {
      const text = pos.join(' ');
      if (text) return { fn, fnArgs: [text] };
    } else if (cmdName === 'verify-no-element' || cmdName === 'verify-element') {
      if (pos[0] && pos.length >= 2) return { fn, fnArgs: [pos[0], pos.slice(1).join(' ')] };
    } else if (pos[0] && pos.length >= 2) {
      const rest = cmdName === 'verify-list' ? pos.slice(1) : pos.slice(1).join(' ');
      return { fn, fnArgs: [pos[0], rest] };
    }
  }

  // ── Navigation ──────────────────────────────────────────────
  if (cmdName === 'goto' || cmdName === 'open') {
    const url = args._[1];
    if (!url) return args; // let error bubble
    return { fn: gotoUrl as PageScriptFn, fnArgs: [url] };
  }
  if (cmdName === 'reload')
    return { fn: reloadPage as PageScriptFn, fnArgs: [] };
  if (cmdName === 'go-back')
    return { fn: goBack as PageScriptFn, fnArgs: [] };
  if (cmdName === 'go-forward')
    return { fn: goForward as PageScriptFn, fnArgs: [] };

  // ── Page info ───────────────────────────────────────────────
  if (cmdName === 'title')
    return { fn: getTitle as PageScriptFn, fnArgs: [] };
  if (cmdName === 'url')
    return { fn: getUrl as PageScriptFn, fnArgs: [] };

  // ── Wait ────────────────────────────────────────────────────
  if (cmdName === 'wait') {
    const ms = parseInt(args._[1]) || 1000;
    return { fn: waitMs as PageScriptFn, fnArgs: [ms] };
  }

  // ── Eval ────────────────────────────────────────────────────
  if (cmdName === 'eval') {
    const code = args._[1] || '';
    return { fn: evalCode as PageScriptFn, fnArgs: [code] };
  }

  if (cmdName === 'run-code') {
    const code = args._[1] || '';
    return { fn: runCode as PageScriptFn, fnArgs: [code] };
  }

  // ── Screenshot ──────────────────────────────────────────────
  if (cmdName === 'screenshot')
    return { fn: takeScreenshot as PageScriptFn, fnArgs: [!!(args.fullPage)] };

  // ── Snapshot ────────────────────────────────────────────────
  if (cmdName === 'snapshot')
    return { fn: takeSnapshot as PageScriptFn, fnArgs: [] };

  // ── Highlight ───────────────────────────────────────────────
  if (cmdName === 'highlight') {
    const loc = args._.slice(1).join(' ');
    if (loc) {
      const isSelector = /[.#[\]>:=]/.test(loc);
      return isSelector
        ? { fn: highlightBySelector as PageScriptFn, fnArgs: [loc] }
        : { fn: highlightByText as PageScriptFn, fnArgs: [loc] };
    }
  }

  // ── >> chaining ─────────────────────────────────────────────
  const LOCATOR_ACTIONS: Record<string, string> = {
    click: 'click', dblclick: 'dblclick', hover: 'hover',
    check: 'check', uncheck: 'uncheck',
    fill: 'fill', select: 'selectOption',
  };
  if (LOCATOR_ACTIONS[cmdName] && args._.some(a => a.includes('>>'))) {
    const action = LOCATOR_ACTIONS[cmdName];
    const positional = args._.slice(1);

    let lastChainIdx = -1;
    for (let i = 0; i < positional.length; i++) {
      if (positional[i] === '>>' || positional[i].includes('>>')) lastChainIdx = i;
    }
    const selectorEnd = positional[lastChainIdx] !== '>>' && positional[lastChainIdx]?.includes('>>')
      ? lastChainIdx
      : lastChainIdx + 1;
    const selector = positional.slice(0, selectorEnd + 1).join(' ');
    const rest = positional.slice(selectorEnd + 1).join(' ');

    return { fn: chainAction as PageScriptFn, fnArgs: [selector, action, rest || undefined] };
  }

  // ── Text locators ───────────────────────────────────────────
  const textFns: Record<string, PageScriptFn> = {
    click: actionByText as PageScriptFn, dblclick: actionByText as PageScriptFn, hover: actionByText as PageScriptFn,
    fill: fillByText as PageScriptFn, select: selectByText as PageScriptFn,
    check: checkByText as PageScriptFn, uncheck: uncheckByText as PageScriptFn,
  };
  if (textFns[cmdName] && args._[1] && !/^e\d+$/.test(args._[1]) && !args._.some(a => a.includes('>>'))) {
    const textArg = args._[1];
    const extraArgs = args._.slice(2);
    const fn = textFns[cmdName];
    const nth = args.nth !== undefined ? parseInt(String(args.nth), 10) : undefined;
    if (fn === (actionByText as PageScriptFn))
      return { fn, fnArgs: [textArg, cmdName, nth] };
    if (cmdName === 'fill' || cmdName === 'select')
      return { fn, fnArgs: [textArg, extraArgs[0] || '', nth] };
    return { fn, fnArgs: [textArg, nth] };
  }

  // ── Ref-based actions (e5, e7, ...) ─────────────────────────
  const REF_ACTIONS: Record<string, string> = {
    click: 'click', dblclick: 'dblclick', hover: 'hover',
    check: 'check', uncheck: 'uncheck',
    fill: 'fill', select: 'selectOption', type: 'fill',
  };
  if (REF_ACTIONS[cmdName] && args._[1] && /^e\d+$/.test(args._[1])) {
    const ref = args._[1];
    const action = REF_ACTIONS[cmdName];
    const value = args._.slice(2).join(' ') || undefined;
    return { fn: refAction as PageScriptFn, fnArgs: [ref, action, value] };
  }

  // ── Press ───────────────────────────────────────────────────
  if (cmdName === 'press') {
    const pos = args._.slice(1);
    if (pos.length === 1) {
      // press <key> — global keyboard press
      return { fn: pressKey as PageScriptFn, fnArgs: [pos[0], pos[0]] };
    }
    if (pos.length >= 2) {
      // press <target> <key>
      return { fn: pressKey as PageScriptFn, fnArgs: [pos[0], pos[1]] };
    }
  }

  // ── Type ────────────────────────────────────────────────────
  if (cmdName === 'type') {
    const text = args._.slice(1).join(' ');
    if (text) return { fn: typeText as PageScriptFn, fnArgs: [text] };
  }

  // ── localStorage ────────────────────────────────────────────
  if (cmdName === 'localstorage-get')
    return { fn: localStorageGet as PageScriptFn, fnArgs: [args._[1]] };
  if (cmdName === 'localstorage-set')
    return { fn: localStorageSet as PageScriptFn, fnArgs: [args._[1], args._.slice(2).join(' ')] };
  if (cmdName === 'localstorage-delete')
    return { fn: localStorageDelete as PageScriptFn, fnArgs: [args._[1]] };
  if (cmdName === 'localstorage-clear')
    return { fn: localStorageClear as PageScriptFn, fnArgs: [] };
  if (cmdName === 'localstorage-list')
    return { fn: localStorageList as PageScriptFn, fnArgs: [] };

  // ── sessionStorage ──────────────────────────────────────────
  if (cmdName === 'sessionstorage-get')
    return { fn: sessionStorageGet as PageScriptFn, fnArgs: [args._[1]] };
  if (cmdName === 'sessionstorage-set')
    return { fn: sessionStorageSet as PageScriptFn, fnArgs: [args._[1], args._.slice(2).join(' ')] };
  if (cmdName === 'sessionstorage-delete')
    return { fn: sessionStorageDelete as PageScriptFn, fnArgs: [args._[1]] };
  if (cmdName === 'sessionstorage-clear')
    return { fn: sessionStorageClear as PageScriptFn, fnArgs: [] };
  if (cmdName === 'sessionstorage-list')
    return { fn: sessionStorageList as PageScriptFn, fnArgs: [] };

  // ── Cookies ─────────────────────────────────────────────────
  if (cmdName === 'cookie-list')
    return { fn: cookieList as PageScriptFn, fnArgs: [] };
  if (cmdName === 'cookie-get')
    return { fn: cookieGet as PageScriptFn, fnArgs: [args._[1]] };
  if (cmdName === 'cookie-clear')
    return { fn: cookieClear as PageScriptFn, fnArgs: [] };

  // ── Tabs ────────────────────────────────────────────────────
  if (cmdName === 'tab-list')
    return { tabOp: 'list', tabArgs: {} };
  if (cmdName === 'tab-new')
    return { tabOp: 'new', tabArgs: { url: args._[1] } };
  if (cmdName === 'tab-close')
    return { tabOp: 'close', tabArgs: { tabId: args._[1] ? parseInt(args._[1]) : undefined } };
  if (cmdName === 'tab-select')
    return { tabOp: 'select', tabArgs: { tabId: args._[1] ? parseInt(args._[1]) : undefined } };

  return args;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function parseReplCommand(input: string): ParseResult {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { error: 'Empty command' };

  // Parse input (tokenize + alias + options)
  const args = parseInput(input);
  if (!args) return { error: 'Empty command' };

  // Resolve to DirectExecution, TabOperation, or unrecognised ParsedArgs
  const resolved = resolveArgs(args);

  // DirectExecution
  if (isDirect(resolved)) return resolved;

  // TabOperation
  if ('tabOp' in resolved) return resolved as TabOperation;

  // Unknown command
  const cmdName = args._[0];
  return { error: `Unknown command: "${cmdName}". Type "help" for commands.` };
}
