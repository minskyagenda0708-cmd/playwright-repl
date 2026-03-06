import { useState } from 'react';
import type { ConsoleEntry, ConsoleExecutors, ConsoleMode } from './types';
import { COMMANDS } from '@/lib/commands';

function detectMode(input: string): ConsoleMode {
    const t = input.trim();
    if (/^(await\s+)?(page|crxApp|activeTabId|expect)\b/.test(t)) return 'playwright';
    const first = t.split(/\s+/)[0].toLowerCase();
    if (first in COMMANDS) return 'pw';
    return 'js';
}

export function useConsole(executors: ConsoleExecutors) {
    const [entries, setEntries] = useState<ConsoleEntry[]>([]);

    function addEntry(entry: ConsoleEntry) {
        setEntries(prev => [...prev, entry]);
    }

    function updateEntry(id: string, patch: Partial<ConsoleEntry>) {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    }

    function clear() {
        setEntries([]);
    }

    async function execute(input: string) {
        const trimmed = input.trim();
        if (!trimmed) return;

        const mode = detectMode(trimmed);
        const id = Math.random().toString(36).slice(2);

        addEntry({ id, input: trimmed, mode, status: 'pending' });

        try {
            if (mode === 'pw') {
                const result = await executors.pw(trimmed);
                updateEntry(id, {
                    status: result.isError ? 'error' : 'done',
                    text: result.text,
                    image: result.image,
                    errorText: result.isError ? result.text : undefined,
                });
            } else if (mode === 'playwright') {
                const text = await executors.playwright(trimmed);
                updateEntry(id, { status: 'done', text });
            } else {
                const result = await executors.js(trimmed);
                if (result.isError) {
                    updateEntry(id, { status: 'error', errorText: result.text });
                } else {
                    updateEntry(id, { status: 'done', value: result.value });
                }
            }
        } catch (e: any) {
            updateEntry(id, { status: 'error', errorText: e?.message ?? String(e) });
        }
    }

    return { entries, execute, clear };
}