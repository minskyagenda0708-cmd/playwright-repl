import { ConsoleEntry } from './ConsoleEntry';
import type { ConsoleEntry as Entry } from './types';

export function ConsoleOutput({ entries }: { entries: Entry[] }) {
    return (
        <>
            {entries.map(e => (
                <ConsoleEntry key={e.id} entry={e} />
            ))}
        </>
    );
}
