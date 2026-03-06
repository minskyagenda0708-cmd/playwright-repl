import { useImperativeHandle, useRef, useEffect, Ref } from 'react';
import { useConsole } from './useConsole';
import { ConsoleOutput } from './ConsoleOutput';
import { ConsoleInput, type ConsoleInputHandle } from './ConsoleInput';
import type { ConsoleHandle, ConsoleProps } from './types';

export { type ConsoleHandle } from './types';

interface Props extends ConsoleProps {
    ref?: Ref<ConsoleHandle>;
}

export function Console({ executors, className, ref }: Props) {
    const { entries, execute, clear } = useConsole(executors);
    const inputRef = useRef<ConsoleInputHandle>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({ clear }));

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [entries]);

    return (
        <div className={`flex flex-col flex-1 min-h-20 overflow-hidden ${className ?? ''}`} data-testid="console-pane">
            <div className="flex-1 overflow-y-auto py-1 px-2">
                <ConsoleOutput entries={entries} />
                <div className="flex items-start gap-1 py-0.5">
                    <span className="text-(--color-prompt) shrink-0">&gt;</span>
                    <ConsoleInput ref={inputRef} onSubmit={execute} onClear={clear} />
                </div>
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
