import { ObjectTree } from './ObjectTree';
import type { ConsoleEntry as Entry } from './types';

export function ConsoleEntry({ entry }: { entry: Entry }) {
    return (
        <div className="flex items-start gap-1 py-0.5 pb-1 border-b border-(--border-primary) last:border-b-0" data-status={entry.status}>
            <span className="text-(--color-prompt) shrink-0">{'>'}</span>
            <div className="flex-1 min-w-0">
                {entry.input.split('\n').map((line, i) => (
                    <div key={i} className="text-(--color-command)">{line}</div>
                ))}
                {entry.status === 'pending' && (
                    <div className="text-(--text-dim) pt-0.5">…</div>
                )}
                {entry.status === 'done' && (
                    <div className="pt-0.5">
                        {entry.value !== undefined ? (
                            <ObjectTree data={entry.value} />
                        ) : (
                            <span className="text-(--color-success)">{entry.text}</span>
                        )}
                    </div>
                )}
                {entry.status === 'error' && (
                    <div className="pt-0.5 text-(--color-error)">{entry.errorText}</div>
                )}
            </div>
        </div>
    );
}
