import { COMMAND_NAMES } from '@/lib/commands';

const PW_COMMANDS = new Set(COMMAND_NAMES);

/**
 * Resolve the execution mode for console input.
 * Multi-line input always runs in the SW context (AsyncFunction supports await).
 */
export function resolveConsoleMode(input: string): 'playwright' | 'js' | 'pw' {
    if (input.includes('\n')) return 'playwright';
    return detectMode(input);
}

export function detectMode(input: string): 'playwright' | 'js' | 'pw' {
    const t = input.trim();
    const firstToken = t.split(/\s+/)[0].toLowerCase();
    if (PW_COMMANDS.has(firstToken)) return 'pw';
    if (t === 'page' || t.startsWith('page.') || t.startsWith('page[') ||
        t.startsWith('await page') ||
        t === 'expect' || t.startsWith('expect(') || t.startsWith('await expect(') ||
        t === 'crxApp' || t.startsWith('crxApp.') ||
        t === 'context' || t.startsWith('context.') || t.startsWith('await context') ||
        t === 'activeTabId') return 'playwright';
    if (firstToken === 'document' || firstToken === 'window') return 'js';
    if (/^[a-z][\w-]*$/.test(firstToken) && !/[.()[\]=+`$;{}"']/.test(t)) return 'pw';
    return 'js';
}
