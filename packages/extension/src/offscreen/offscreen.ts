import { swDebugEval, swCallFunctionOn } from '../panel/lib/sw-debugger';
import { parseReplCommand } from '../commands';

async function executeForBridge(command: string): Promise<{
    text: string; isError: boolean; image?: string;
}> {
    const parsed = parseReplCommand(command);
    if ('error' in parsed) return { text: parsed.error, isError: true };
    if ('help'  in parsed) return { text: parsed.help,  isError: false };

    try {
        const raw = await swDebugEval(parsed.jsExpr) as any;
        const r = raw?.result;

        if (!r || r.type === 'undefined') return { text: 'Done', isError: false };

        if (r.type === 'string') {
            try {
                const obj = JSON.parse(r.value as string);
                if (obj?.__image) {
                    return { text: '', image: `data:${obj.mimeType};base64,${obj.__image}`, isError: false };
                }
            } catch { /* not JSON */ }
            return { text: r.value as string, isError: false };
        }

        if (r.type === 'number' || r.type === 'boolean') {
            return { text: String(r.value), isError: false };
        }

        // Object/Array: serialize via callFunctionOn to avoid re-executing the expression
        if (r.objectId) {
            try {
                const serialized = await swCallFunctionOn(
                    r.objectId,
                    'function() { try { return JSON.stringify(this, null, 2); } catch(e) { return String(this); } }'
                ) as any;
                if (serialized?.result?.value) {
                    return { text: serialized.result.value as string, isError: false };
                }
            } catch { /* fall through */ }
        }

        return { text: (r.description as string) ?? 'Done', isError: false };
    } catch (e: any) {
        return { text: e?.message ?? String(e), isError: true };
    }
}

const port = chrome.runtime.connect({ name: 'bridge-executor' });

port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'bridge-execute') return;
    const result = await executeForBridge(msg.command as string)
        .catch(err => ({ text: String(err), isError: true }));
    port.postMessage({ type: 'bridge-result', id: msg.id, ...result });
});
