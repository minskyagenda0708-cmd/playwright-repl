import { useEffect, useRef } from 'react';
import { ConsoleEntry } from './ConsoleEntry';
import type { ConsoleEntry as Entry } from './types';

export function ConsoleOutput({ entries }: { entries: Entry[] }) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [entries]);

    return (
        <div className="flex-1 overflow-y-auto py-1 px-2">
            {entries.map(e => (
                <ConsoleEntry key={e.id} entry={e} />
            ))}
            <div ref={bottomRef} />
        </div>
    );
}