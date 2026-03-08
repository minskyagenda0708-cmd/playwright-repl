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

// The offscreen document is a persistent extension page — it stays alive and
// can maintain a stable WebSocket connection (unlike the service worker).
function connectToCLI(wsPort = 9876) {
    try {
        const ws = new WebSocket(`ws://localhost:${wsPort}`);
        ws.onmessage = async (e) => {
            const msg = JSON.parse(e.data as string) as { id: string; command: string };
            const result = await executeForBridge(msg.command)
                .catch((err: any) => ({ text: String(err), isError: true }));
            if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ id: msg.id, ...result }));
        };
        ws.onclose = () => setTimeout(() => connectToCLI(wsPort), 3000);
        ws.onerror = () => {};
    } catch {
        setTimeout(() => connectToCLI(wsPort), 3000);
    }
}

connectToCLI();
