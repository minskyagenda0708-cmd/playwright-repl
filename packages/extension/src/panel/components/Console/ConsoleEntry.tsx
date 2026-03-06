import { ObjectTree } from './ObjectTree';
import type { ConsoleEntry as Entry } from './types';

const MODE_LABEL: Record<string, string> = {
    pw: 'pw',
    playwright: 'js*',
    js: 'js',
};

export function ConsoleEntry({ entry }: { entry: Entry }) {
    return (
        <div className="py-0.5 pb-1 border-b border-(--border-primary) last:border-b-0" data-status={entry.status}>

            {/* Input line */}
            <div className="flex items-baseline gap-1">
                <span className="text-(--color-prompt) shrink-0">&gt;</span>
                <span className="flex-1 text-(--color-command)">{entry.input}</span>
                <span
                    className="text-[10px] px-1 rounded-[3px] text-(--text-dim) bg-(--bg-button) shrink-0 data-[mode=pw]:text-(--color-success) data-[mode=js]:text-(--color-command) data-[mode=playwright]:text-(--color-snapshot)"
                    data-mode={entry.mode}
                >
                    {MODE_LABEL[entry.mode]}
                </span>
            </div>

            {/* Result */}
            {entry.status === 'pending' && (
                <div className="pl-4 text-(--text-dim)">…</div>
            )}

            {entry.status === 'done' && (
                <div className="pl-4 pt-0.5">
                    {entry.image ? (
                        <img src={entry.image} className="max-w-full border border-(--border-screenshot) rounded-sm" alt="screenshot" />
                    ) : entry.value !== undefined ? (
                        <ObjectTree data={entry.value} />
                    ) : (
                        <span className="text-(--color-success)">{entry.text}</span>
                    )}
                </div>
            )}

            {entry.status === 'error' && (
                <div className="pl-4 pt-0.5 text-(--color-error)">{entry.errorText}</div>
            )}

        </div>
    );
}