// ─── JSONL → REPL conversion (for port-based recorder) ───

import { asPwLocator } from '@/lib/pw-locator';

/**
 * Convert a recorder locator chain ({ kind, body, options?, next? })
 * to an internal selector string that parseSelector() understands.
 * Prefers this over a.selector because the chain has role names / accessible names
 * while a.selector often has raw CSS.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function locatorChainToSelector(loc: any): string {
  const parts: string[] = [];
  while (loc) {
    switch (loc.kind) {
      case 'role':
        if (loc.options?.name) parts.push(`internal:role=${loc.body}[name="${loc.options.name}"s]`);
        else parts.push(`internal:role=${loc.body}`);
        break;
      case 'text':
        parts.push(`internal:text="${loc.body}"i`);
        break;
      case 'label':
        parts.push(`internal:label="${loc.body}"s`);
        break;
      case 'placeholder':
        parts.push(`internal:attr=[placeholder="${loc.body}"s]`);
        break;
      case 'alt':
        parts.push(`internal:attr=[alt="${loc.body}"s]`);
        break;
      case 'title':
        parts.push(`internal:attr=[title="${loc.body}"s]`);
        break;
      case 'test-id':
        parts.push(`internal:testid=[data-testid="${loc.body}"s]`);
        break;
      case 'nth':
        parts.push(`nth=${loc.body}`);
        break;
      case 'first':
        parts.push('nth=0');
        break;
      case 'last':
        parts.push('nth=-1');
        break;
      default:
        if (loc.body) parts.push(loc.body);
        break;
    }
    loc = loc.next;
  }
  return parts.join(' >> ');
}

/**
 * Converts a Playwright recorder JSONL action string to a REPL command.
 * Returns null if the action should be skipped.
 */
export function jsonlToRepl(jsonStr: string, isFirst: boolean): string | null {
  try {
    const a = JSON.parse(jsonStr);
    const q = (s: string) => `"${s}"`;

    // Try a.locator first (has role names, readable), fall back to a.selector (CSS, reliable)
    const fromLocator = a.locator ? asPwLocator(locatorChainToSelector(a.locator)) : null;
    const fromSelector = a.selector ? asPwLocator(a.selector) : null;

    // Use locator chain if it produced a named locator (has quoted name),
    // otherwise fall back to selector. Bare role names without accessible names are less reliable.
    const locatorHasName = fromLocator && fromLocator.locator.includes('"');
    const pw = locatorHasName ? fromLocator : (fromSelector ?? fromLocator);
    const loc = pw?.locator ?? '';
    const role = pw?.role ?? '';

    // Separate locator text from nth flag for actions that insert value between them
    // e.g. '"Submit" --nth 0' → locText='"Submit"', nthFlag=' --nth 0'
    const nthIdx = loc.indexOf(' --nth ');
    const locText = nthIdx >= 0 ? loc.slice(0, nthIdx) : loc;
    const nthFlag = nthIdx >= 0 ? loc.slice(nthIdx) : '';

    switch (a.name) {
      case 'navigate':
        if (isFirst) return null;
        return `goto ${q(a.url)}`;
      case 'openPage':
        return a.url && a.url !== 'about:blank' && a.url !== 'chrome://newtab/'
          ? `goto ${q(a.url)}`
          : '# new tab opened';
      case 'closePage':
        return '# tab closed';

      case 'click':
        if (role === 'textbox') return null;
        if (!locText) return null;
        if (a.selector && ['html', 'body'].includes(a.selector.trim())) return null;
        return `click ${locText}${nthFlag}`;

      case 'fill':
        if (!locText) return null;
        return `fill ${locText} ${q(a.text ?? '')}${nthFlag}`;

      case 'press':
        if (locText) return `press ${locText} ${a.key ?? ''}${nthFlag}`;
        return a.key ? `press ${a.key}` : null;

      case 'hover':
        if (!locText) return null;
        return `hover ${locText}${nthFlag}`;

      case 'check':
        if (!locText) return null;
        return `check ${locText}${nthFlag}`;

      case 'uncheck':
        if (!locText) return null;
        return `uncheck ${locText}${nthFlag}`;

      case 'selectOption':
      case 'select':
        if (!locText) return null;
        return `select ${locText} ${q(a.options?.[0] ?? '')}${nthFlag}`;

      case 'setInputFiles':
        return '# file upload (unsupported)';

      // ─── Assertions ───────────────────────────────────────────
      case 'assertVisible':
        if (!locText) return null;
        // locText already includes role when available (e.g. button "Submit")
        if (role) return `verify-visible ${locText}`;
        return `verify text ${locText}`;

      case 'assertText':
        return a.text ? `verify text ${q(a.text)}` : null;

      case 'assertValue':
        if (!locText || a.value == null) return null;
        return `verify-value ${locText} ${q(String(a.value))}`;

      case 'assertChecked':
        if (!locText) return null;
        return `verify-value ${locText} ${q(a.checked ? 'checked' : 'unchecked')}`;

      default:
        return `# ${a.name} (unsupported)`;
    }
  } catch {
    return null;
  }
}
