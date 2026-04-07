/**
 * Recorder content script.
 * Injected into the active tab via chrome.scripting.executeScript.
 * Captures DOM events, marks elements with data-pw-rec-id, and sends:
 * - recId: for panel-side locator resolution via normalize() (JS mode)
 * - pw: pre-built .pw keyword command (PW mode)
 * - action + opts: action type and parameters
 *
 * Transparent: never calls preventDefault/stopPropagation — user actions flow normally.
 */
import { escapeString, isTextField, isCheckable, buildCommands, findHoverAncestor, isHoverRevealed } from './locator';

// ─── Element marking ─────────────────────────────────────────────────────

let recIdCounter = 0;
function markElement(el: Element): string {
    const existing = el.getAttribute('data-pw-rec-id');
    if (existing) return existing;
    const id = `rec-${++recIdCounter}-${Date.now()}`;
    el.setAttribute('data-pw-rec-id', id);
    return id;
}

// ─── Special key detection ────────────────────────────────────────────────

export const SPECIAL_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

// ─── Fill buffering state machine ─────────────────────────────────────────

export let pendingFill: { el: Element; recId: string; value: string } | null = null;

export function flushPendingFill() {
    pendingFill = null;
}

// ─── Event handlers (capture phase, transparent) ──────────────────────────

export function onClickCapture(e: MouseEvent) {
    const target = e.target as Element;
    if (!target) return;
    if (isTextField(target)) return;
    if (isCheckable(target)) return;
    flushPendingFill();

    // Detect hover-revealed elements
    if (isHoverRevealed(target)) {
        const hoverTarget = findHoverAncestor(target);
        if (hoverTarget) {
            const hoverCmds = buildCommands('hover', hoverTarget);
            if (hoverCmds) {
                const hoverRecId = markElement(hoverTarget);
                chrome.runtime.sendMessage({ type: 'recorded-action', recId: hoverRecId, action: 'hover', pw: hoverCmds.pw });
            }
        }
    }

    const cmds = buildCommands('click', target);
    if (cmds) {
        const recId = markElement(target);
        chrome.runtime.sendMessage({ type: 'recorded-action', recId, action: 'click', pw: cmds.pw });
    }
}

export function onInputCapture(e: Event) {
    const target = e.target as Element;
    if (!target || !isTextField(target)) return;

    const value = (target as HTMLInputElement | HTMLTextAreaElement).value ?? '';
    const recId = markElement(target);

    if (pendingFill && pendingFill.el === target) {
        pendingFill.value = value;
        const cmds = buildCommands('fill', target, { value });
        if (cmds) {
            chrome.runtime.sendMessage({ type: 'recorded-fill-update', recId, action: 'fill', opts: { value }, pw: cmds.pw });
        }
    } else {
        flushPendingFill();
        pendingFill = { el: target, recId, value };
        const cmds = buildCommands('fill', target, { value });
        if (cmds) {
            chrome.runtime.sendMessage({ type: 'recorded-action', recId, action: 'fill', opts: { value }, pw: cmds.pw });
        }
    }
}

export function onChangeCapture(e: Event) {
    const target = e.target as Element;
    if (!target) return;

    if (isCheckable(target)) {
        flushPendingFill();
        const checked = (target as HTMLInputElement).checked;
        const action = checked ? 'check' : 'uncheck';
        const cmds = buildCommands(action, target);
        if (cmds) {
            const recId = markElement(target);
            chrome.runtime.sendMessage({ type: 'recorded-action', recId, action, pw: cmds.pw });
        }
        return;
    }

    if (target instanceof HTMLSelectElement) {
        flushPendingFill();
        const option = target.value;
        const cmds = buildCommands('select', target, { option });
        if (cmds) {
            const recId = markElement(target);
            chrome.runtime.sendMessage({ type: 'recorded-action', recId, action: 'select', opts: { option }, pw: cmds.pw });
        }
        return;
    }
}

export function onKeyDownCapture(e: KeyboardEvent) {
    if (!SPECIAL_KEYS.has(e.key)) return;

    const target = e.target as Element;
    if (e.key === 'Tab') { flushPendingFill(); return; }
    if (e.key !== 'Enter' && target && isTextField(target)) return;
    flushPendingFill();

    const hasTarget = target && target !== document.body && target !== document.documentElement;
    const cmds = hasTarget
        ? buildCommands('press', target, { key: e.key })
        : { pw: `press ${e.key}`, js: `await page.keyboard.press(${escapeString(e.key)});` };
    if (cmds) {
        const recId = hasTarget ? markElement(target) : '';
        chrome.runtime.sendMessage({ type: 'recorded-action', recId, action: 'press', opts: { key: e.key }, pw: cmds.pw });
    }
}

export function onFocusOutCapture(e: FocusEvent) {
    if (pendingFill && e.target === pendingFill.el) {
        flushPendingFill();
    }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

export function cleanup() {
    flushPendingFill();
    (window as any).__pw_recorder_active = false;
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('input', onInputCapture, true);
    document.removeEventListener('change', onChangeCapture, true);
    document.removeEventListener('keydown', onKeyDownCapture, true);
    document.removeEventListener('focusout', onFocusOutCapture, true);
    chrome.runtime.onMessage.removeListener(onMessage);
}

function onMessage(msg: any) {
    if (msg.type === 'record-stop') cleanup();
}

// ─── Init ────────────────────────────────────────────────────────────────

export function init() {
    if ((window as any).__pw_recorder_active) return;
    (window as any).__pw_recorder_active = true;

    chrome.runtime.onMessage.addListener(onMessage);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('input', onInputCapture, true);
    document.addEventListener('change', onChangeCapture, true);
    document.addEventListener('keydown', onKeyDownCapture, true);
    document.addEventListener('focusout', onFocusOutCapture, true);
}

init();
