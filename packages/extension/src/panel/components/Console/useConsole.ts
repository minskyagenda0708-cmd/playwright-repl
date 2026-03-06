import { useState } from 'react';
import type { ConsoleEntry, ConsoleExecutors } from './types';

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

        const id = Math.random().toString(36).slice(2);
        addEntry({ id, input: trimmed, status: 'pending' });

        try {
            const result = await executors.playwright(trimmed);
            updateEntry(id, { status: 'done', value: result.value, text: result.text });
        } catch (e: any) {
            updateEntry(id, { status: 'error', errorText: e?.message ?? String(e) });
        }
    }

    return { entries, execute, clear };
}
