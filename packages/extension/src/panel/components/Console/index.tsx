import { useImperativeHandle, useRef, Ref } from 'react';
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

    useImperativeHandle(ref, () => ({ clear }));

    return (
        <div className={`flex flex-col flex-1 min-h-20 overflow-hidden ${className ?? ''}`} data-testid="console-pane">
            <ConsoleOutput entries={entries} />
            <div className="flex items-start gap-1 border-t border-(--border-primary) py-1 px-2">
                <span className="text-(--color-prompt) shrink-0">&gt;</span>
                <ConsoleInput ref={inputRef} onSubmit={execute} onClear={clear} />
            </div>
        </div>
    );
}