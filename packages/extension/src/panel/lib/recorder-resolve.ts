/**
 * Recorder locator resolution — resolves data-pw-rec-id markers to
 * best-practice Playwright locators via normalize().toString(),
 * and builds JS/PW commands from action type + locator.
 */

import { swDebugEval } from '@/lib/sw-debugger';

/**
 * Resolve a data-pw-rec-id marker to a Playwright locator string.
 */
export async function resolveRecLocator(recId: string): Promise<string | null> {
    try {
        const selector = `[data-pw-rec-id="${recId}"]`;
        const expr = `page.locator('${selector}').normalize().then(l => l.toString())`;
        const result = await swDebugEval(expr) as { result?: { type?: string; value?: string } };
        if (result?.result?.type === 'string' && result.result.value)
            return result.result.value;
        return null;
    } catch {
        return null;
    }
}

/**
 * Remove data-pw-rec-id attribute from an element.
 */
export function cleanupRecMarker(recId: string): void {
    const selector = `[data-pw-rec-id="${recId}"]`;
    const expr = `page.locator('${selector}').evaluate(el => el.removeAttribute('data-pw-rec-id'))`;
    swDebugEval(expr).catch(() => {});
}

// ─── Command building ──────────────────────────────────────────────────────

function escapeStr(s: string): string {
    return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Build a JS Playwright command from locator + action + opts.
 */
export function buildJsCommand(locatorStr: string, action: string, opts?: Record<string, unknown>): string {
    const loc = `page.${locatorStr}`;
    switch (action) {
        case 'click':   return `await ${loc}.click();`;
        case 'hover':   return `await ${loc}.hover();`;
        case 'fill':    return `await ${loc}.fill(${escapeStr(String(opts?.value ?? ''))});`;
        case 'check':   return `await ${loc}.check();`;
        case 'uncheck': return `await ${loc}.uncheck();`;
        case 'select':  return `await ${loc}.selectOption(${escapeStr(String(opts?.option ?? ''))});`;
        case 'press':
            if (locatorStr) return `await ${loc}.press(${escapeStr(String(opts?.key ?? ''))});`;
            return `await page.keyboard.press(${escapeStr(String(opts?.key ?? ''))});`;
        default: return `// unknown action: ${action}`;
    }
}

/**
 * Extract role and name from a JS locator string for PW command building.
 */
function extractRoleName(locatorStr: string): { role?: string; name?: string } {
    const roleNameMatch = locatorStr.match(/getByRole\(['"](.+?)['"],\s*\{[^}]*name:\s*['"](.+?)['"]/);
    if (roleNameMatch) return { role: roleNameMatch[1], name: roleNameMatch[2] };
    const labelMatch = locatorStr.match(/getByLabel\(['"](.+?)['"]\)/);
    if (labelMatch) return { name: labelMatch[1] };
    const textMatch = locatorStr.match(/getByText\(['"](.+?)['"]\)/);
    if (textMatch) return { name: textMatch[1] };
    const placeholderMatch = locatorStr.match(/getByPlaceholder\(['"](.+?)['"]\)/);
    if (placeholderMatch) return { name: placeholderMatch[1] };
    const testIdMatch = locatorStr.match(/getByTestId\(['"](.+?)['"]\)/);
    if (testIdMatch) return { name: testIdMatch[1] };
    return {};
}

/**
 * Build a PW keyword command from locator + action + opts.
 */
export function buildPwCommand(locatorStr: string, action: string, opts?: Record<string, unknown>): string {
    const { role, name } = extractRoleName(locatorStr);
    const target = role && name ? `${role} "${name}"` : name ? `"${name}"` : '';

    switch (action) {
        case 'click':   return `click ${target}`;
        case 'hover':   return `hover ${target}`;
        case 'fill':    return `fill ${target} "${opts?.value ?? ''}"`;
        case 'check':   return `check ${target}`;
        case 'uncheck': return `uncheck ${target}`;
        case 'select':  return `select ${target} "${opts?.option ?? ''}"`;
        case 'press':
            if (target) return `press ${target} ${opts?.key ?? ''}`;
            return `press ${opts?.key ?? ''}`;
        default: return `# unknown action: ${action}`;
    }
}
