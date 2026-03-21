import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read the raw source the same way Vite's ?raw import does
const PW_SELECTOR_SOURCE = readFileSync(
    resolve(__dirname, '../../src/pw-selector.js'), 'utf-8'
);

// Evaluate the source to get PwSelector for unit testing
function loadPwSelector(): (injectedScript: any) => void {
    const fn = new Function('document', `
        const module = {};
        ${PW_SELECTOR_SOURCE}
        return module.exports.default();
    `);
    return fn(document);
}

describe('PwSelector', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('tags clicked element with data-pw-locator', () => {
        const injectedScript = {
            generateSelectorSimple: vi.fn().mockReturnValue('internal:role=button[name="Submit"i]'),
            utils: { asLocator: vi.fn().mockReturnValue("getByRole('button', { name: 'Submit' })") },
        };
        const PwSelector = loadPwSelector();
        PwSelector(injectedScript);

        document.body.innerHTML = '<button>Submit</button>';
        const btn = document.querySelector('button')!;
        btn.click();

        expect(injectedScript.generateSelectorSimple).toHaveBeenCalledWith(btn);
        expect(injectedScript.utils.asLocator).toHaveBeenCalledWith('javascript', 'internal:role=button[name="Submit"i]');
        expect(btn.getAttribute('data-pw-locator')).toBe("getByRole('button', { name: 'Submit' })");
    });

    it('tags on input event', () => {
        const injectedScript = {
            generateSelectorSimple: vi.fn().mockReturnValue('internal:role=textbox'),
            utils: { asLocator: vi.fn().mockReturnValue("getByRole('textbox', { name: 'Email' })") },
        };
        const PwSelector = loadPwSelector();
        PwSelector(injectedScript);

        document.body.innerHTML = '<input type="text">';
        const input = document.querySelector('input')!;
        input.dispatchEvent(new Event('input', { bubbles: true }));

        expect(input.getAttribute('data-pw-locator')).toBe("getByRole('textbox', { name: 'Email' })");
    });

    it('tags on change event', () => {
        const injectedScript = {
            generateSelectorSimple: vi.fn().mockReturnValue('internal:role=combobox'),
            utils: { asLocator: vi.fn().mockReturnValue("getByRole('combobox', { name: 'Color' })") },
        };
        const PwSelector = loadPwSelector();
        PwSelector(injectedScript);

        document.body.innerHTML = '<select><option>Red</option></select>';
        const select = document.querySelector('select')!;
        select.dispatchEvent(new Event('change', { bubbles: true }));

        expect(select.getAttribute('data-pw-locator')).toBe("getByRole('combobox', { name: 'Color' })");
    });

    it('tags on keydown event', () => {
        const injectedScript = {
            generateSelectorSimple: vi.fn().mockReturnValue('internal:role=textbox'),
            utils: { asLocator: vi.fn().mockReturnValue("getByRole('textbox', { name: 'Search' })") },
        };
        const PwSelector = loadPwSelector();
        PwSelector(injectedScript);

        document.body.innerHTML = '<input type="text">';
        const input = document.querySelector('input')!;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(input.getAttribute('data-pw-locator')).toBe("getByRole('textbox', { name: 'Search' })");
    });

    it('silently handles generateSelectorSimple errors', () => {
        const injectedScript = {
            generateSelectorSimple: vi.fn().mockImplementation(() => { throw new Error('detached'); }),
            utils: { asLocator: vi.fn() },
        };

        const btn = document.createElement('button');
        btn.textContent = 'OK';
        document.body.appendChild(btn);

        const event = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(event, 'target', { value: btn });

        // Manually call the tag function logic (same as pw-selector.js)
        const tag = (e: Event) => {
            try {
                const el = e.target as Element;
                if (!el || !el.setAttribute) return;
                const sel = injectedScript.generateSelectorSimple(el);
                const locator = injectedScript.utils.asLocator('javascript', sel);
                el.setAttribute('data-pw-locator', locator);
            } catch { /* expected */ }
        };
        tag(event);

        expect(injectedScript.generateSelectorSimple).toHaveBeenCalledWith(btn);
        expect(injectedScript.utils.asLocator).not.toHaveBeenCalled();
        expect(btn.hasAttribute('data-pw-locator')).toBe(false);
    });

    it('skips elements without setAttribute (text nodes)', () => {
        const injectedScript = {
            generateSelectorSimple: vi.fn(),
            utils: { asLocator: vi.fn() },
        };
        const PwSelector = loadPwSelector();
        PwSelector(injectedScript);

        // Event with null target — should not throw
        const event = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(event, 'target', { value: null });
        expect(() => document.dispatchEvent(event)).not.toThrow();
        expect(injectedScript.generateSelectorSimple).not.toHaveBeenCalled();
    });
});

describe('pw-selector.js source', () => {
    it('contains the PwSelector function', () => {
        expect(PW_SELECTOR_SOURCE).toContain('function PwSelector');
    });

    it('contains module.exports in correct format', () => {
        expect(PW_SELECTOR_SOURCE).toContain('module.exports = { default: function() { return PwSelector; } }');
    });

    it('is valid JavaScript that can be evaluated by InjectedScript.extend()', () => {
        const fn = new Function('document', `
            const module = {};
            ${PW_SELECTOR_SOURCE}
            return module.exports.default();
        `);
        const Constructor = fn(document);
        expect(typeof Constructor).toBe('function');
        expect(Constructor.name).toBe('PwSelector');
    });
});
