import type { Page } from 'playwright-crx';
import { snapshot, resolveRef } from './snapshot';

export interface Result {
  text: string;
  isError: boolean;
}

function getLocator(page: Page, ref: string) {
  const entry = resolveRef(ref);
  return page.getByRole(entry.role as any, { name: entry.name, exact: true });
}

export async function execute(command: string, page: Page): Promise<Result> {
  const [keyword, ...args] = command.trim().split(/\s+/);

  try {
    switch (keyword) {
      case 'snapshot':
        return { text: await snapshot(page), isError: false };

      // goto, back, forward, reload are handled in background.ts via Chrome APIs

      case 'click': {
        if (!args[0]) return { text: 'Usage: click <ref>', isError: true };
        await getLocator(page, args[0]).click();
        return { text: 'Clicked', isError: false };
      }

      case 'fill': {
        if (args.length < 2) return { text: 'Usage: fill <ref> <text>', isError: true };
        await getLocator(page, args[0]).fill(args.slice(1).join(' '));
        return { text: 'Filled', isError: false };
      }

      case 'type': {
        if (args.length < 2) return { text: 'Usage: type <ref> <text>', isError: true };
        await getLocator(page, args[0]).pressSequentially(args.slice(1).join(' '));
        return { text: 'Typed', isError: false };
      }

      case 'press': {
        if (args.length < 2) return { text: 'Usage: press <ref> <key>', isError: true };
        await getLocator(page, args[0]).press(args.slice(1).join('+'));
        return { text: 'Pressed', isError: false };
      }

      case 'hover': {
        if (!args[0]) return { text: 'Usage: hover <ref>', isError: true };
        await getLocator(page, args[0]).hover();
        return { text: 'Hovered', isError: false };
      }

      case 'select': {
        if (args.length < 2) return { text: 'Usage: select <ref> <value>', isError: true };
        await getLocator(page, args[0]).selectOption(args.slice(1).join(' '));
        return { text: 'Selected', isError: false };
      }

      case 'check': {
        if (!args[0]) return { text: 'Usage: check <ref>', isError: true };
        await getLocator(page, args[0]).check();
        return { text: 'Checked', isError: false };
      }

      case 'uncheck': {
        if (!args[0]) return { text: 'Usage: uncheck <ref>', isError: true };
        await getLocator(page, args[0]).uncheck();
        return { text: 'Unchecked', isError: false };
      }

      case 'screenshot': {
        const buf = await page.screenshot();
        const base64 = buf.toString('base64');
        return { text: `data:image/png;base64,${base64}`, isError: false };
      }


      case 'wait': {
        const ms = parseInt(args[0]) || 1000;
        await page.waitForTimeout(ms);
        return { text: `Waited ${ms}ms`, isError: false };
      }

      case 'title': {
        const title = await page.title();
        return { text: title, isError: false };
      }

      case 'url':
        return { text: page.url(), isError: false };

      case 'help':
        return {
          text: [
            'Commands:',
            '  snapshot          — show accessibility tree with refs',
            '  goto <url>        — navigate to URL',
            '  click <ref>       — click element',
            '  fill <ref> <text> — fill input with text',
            '  type <ref> <text> — type text character by character',
            '  press <ref> <key> — press key (e.g. Enter, Tab)',
            '  hover <ref>       — hover over element',
            '  select <ref> <v>  — select option by value',
            '  check <ref>       — check checkbox',
            '  uncheck <ref>     — uncheck checkbox',
            '  screenshot        — capture screenshot',
            '  back / forward    — navigate history',
            '  reload            — reload page',
            '  wait [ms]         — wait (default 1000ms)',
            '  title / url       — show page title or URL',
          ].join('\n'),
          isError: false,
        };

      default:
        return { text: `Unknown command: ${keyword}. Type "help" for commands.`, isError: true };
    }
  } catch (e) {
    return { text: String(e), isError: true };
  }
}
