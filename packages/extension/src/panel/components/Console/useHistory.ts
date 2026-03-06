import { useRef } from 'react';

export function useHistory() {
    const stack = useRef<string[]>([]);
    const idx = useRef(-1);
    const draft = useRef('');

    function push(entry: string) {
        if (entry && entry !== stack.current[0]) {
            stack.current.unshift(entry);
        }
        idx.current = -1;
        draft.current = '';
    }

    function goBack(current: string): string | null {
        if (idx.current === -1) draft.current = current;
        if (idx.current < stack.current.length - 1) {
            idx.current++;
            return stack.current[idx.current];
        }
        return null;
    }

    function goForward(): string | null {
        if (idx.current > 0) {
            idx.current--;
            return stack.current[idx.current];
        }
        if (idx.current === 0) {
            idx.current = -1;
            return draft.current;
        }
        return null;
    }

    return { push, goBack, goForward };
}