// ─── PwLocatorFactory — generates pw-repl locator strings ───

import type { LocatorFactory, LocatorBase, LocatorType, LocatorOptions } from '@/lib/locator/locatorGenerators';
import { innerAsLocators } from '@/lib/locator/locatorGenerators';
import { parseSelector, parseAttributeSelector } from '@/lib/locator/selectorParser';

class PwLocatorFactory implements LocatorFactory {
  generateLocator(_base: LocatorBase, kind: LocatorType, body: string | RegExp, options: LocatorOptions = {}): string {
    switch (kind) {
      case 'role':
        // Has accessible name → quoted text; no name → unquoted role
        if (options.name) return isRegExp(options.name) ? String(options.name) : `"${options.name}"`;
        return String(body);
      case 'text': case 'label': case 'placeholder': case 'alt': case 'title':
        return isRegExp(body) ? String(body) : `"${body}"`;
      case 'test-id':
        return isRegExp(body) ? String(body) : `"${body}"`;
      case 'default':
        return `"${body}"`;
      case 'nth':
        return ` --nth ${body}`;
      case 'first':
        return ' --nth 0';
      case 'last':
        return ' --nth -1';
      default:
        return '';
    }
  }

  chainLocators(locators: string[]): string {
    // In pw mode, keep only the last "main" locator + any --nth flags.
    // CSS parent selectors (e.g. "div") are discarded — keyword commands
    // don't support chained locators like JS mode's page.locator('div').getByRole('tab').
    let main = '';
    let nth = '';
    for (const loc of locators) {
      if (!loc) continue;
      if (loc.startsWith(' --nth ')) nth = loc;
      else main = loc;
    }
    return main + nth;
  }
}

function isRegExp(obj: unknown): obj is RegExp {
  return obj instanceof RegExp;
}

/**
 * Convert a Playwright selector string to a pw-repl locator.
 * Returns { locator, role } or null on failure.
 *
 * - locator: formatted string like `"Submit" --nth 0` or `button`
 * - role: the ARIA role name (e.g. 'textbox', 'button') or '' if not a role selector
 */
export function asPwLocator(selector: string): { locator: string; role: string } | null {
  try {
    const parsed = parseSelector(selector);
    let role = '';
    for (const part of parsed.parts) {
      if (part.name === 'internal:role') {
        role = parseAttributeSelector(part.body as string, true).name;
        break;
      }
    }
    const results = innerAsLocators(new PwLocatorFactory(), parsed, false, 1);
    return results.length ? { locator: results[0], role } : null;
  } catch {
    return null;
  }
}
