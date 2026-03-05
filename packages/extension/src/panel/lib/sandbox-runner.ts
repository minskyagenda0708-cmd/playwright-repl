/**
 * Manages the sandboxed iframe used to execute run-code commands.
 *
 * The sandbox page (sandbox.html) has a relaxed CSP that allows eval/new AsyncFunction.
 * It communicates with the panel via postMessage:
 *
 *   panel → sandbox:  { type: 'run-code', code, id }
 *   sandbox → panel:  { type: 'page-call', chain: [{method, args}], id }  (chained call)
 *   panel → sandbox:  { type: 'page-result', id, result | error }
 *   sandbox → panel:  { type: 'run-code-result', id, result | error }
 *
 * Each page method call is forwarded to background.ts via chrome.runtime.sendMessage.
 */

type PendingRun = { resolve: (v: string) => void; reject: (e: unknown) => void };

let frame: HTMLIFrameElement | null = null;
let frameReady: Promise<HTMLIFrameElement> | null = null;
const pendingRuns = new Map<string, PendingRun>();

function initSandbox(): Promise<HTMLIFrameElement> {
    if (frameReady) return frameReady;

    frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('sandbox.html');
    frame.style.cssText = 'display:none;position:absolute;width:0;height:0;border:none;';
    document.body.appendChild(frame);

    frameReady = new Promise<HTMLIFrameElement>(resolve => {
        frame!.addEventListener('load', () => resolve(frame!), { once: true });
    });

    window.addEventListener('message', async (e: MessageEvent) => {
        if (!e.data) return;

        // page chain call from sandbox → forward full chain to background
        if (e.data.type === 'page-call') {
            const { chain, id } = e.data;
            try {
                // chrome.runtime.sendMessage uses JSON — serialize RegExp args so they survive
                const serialized = (chain as { method: string; args: unknown[] }[]).map(step => ({
                    ...step,
                    args: step.args.map(a =>
                        a instanceof RegExp ? { __type: 'RegExp', source: a.source, flags: a.flags } : a
                    ),
                }));
                const response = await chrome.runtime.sendMessage({ type: 'page-call', chain: serialized });
                if (response?.error) {
                    frame!.contentWindow!.postMessage(
                        { type: 'page-result', id, error: response.error },
                        '*'
                    );
                } else {
                    frame!.contentWindow!.postMessage(
                        { type: 'page-result', id, result: response?.result ?? null },
                        '*'
                    );
                }
            } catch (err) {
                frame!.contentWindow!.postMessage(
                    { type: 'page-result', id, error: String(err) },
                    '*'
                );
            }
        }

        // run-code completed
        if (e.data.type === 'run-code-result') {
            const { id, result, error } = e.data;
            const pending = pendingRuns.get(id);
            if (!pending) return;
            pendingRuns.delete(id);
            if (error) pending.reject(error);
            else pending.resolve(result);
        }
    });

    return frameReady;
}

export async function runCodeInSandbox(code: string): Promise<string> {
    const f = await initSandbox();
    const id = Math.random().toString(36).slice(2);
    return new Promise<string>((resolve, reject) => {
        pendingRuns.set(id, { resolve, reject });
        f.contentWindow!.postMessage({ type: 'run-code', code, id }, '*');
    });
}
