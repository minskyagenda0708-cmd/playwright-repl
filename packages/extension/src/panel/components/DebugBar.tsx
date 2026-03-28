import type { Action } from '@/reducer';
import { swDebugResume, swDebugStepOver, swDebugStepInto, swDebugStepOut, swTerminateExecution } from '@/lib/sw-debugger';
import { ContinueIcon, StepOverIcon, StepIntoIcon, StepOutIcon, RestartIcon, DebugStopIcon } from './Icons';

interface DebugBarProps {
    dispatch: React.Dispatch<Action>;
}

function DebugBar({ dispatch }: DebugBarProps) {
    function handleContinue() {
        swDebugResume().catch(e => console.warn('[debug] resume failed:', e));
    }

    function handleStepOver() {
        swDebugStepOver().catch(e => console.warn('[debug] step-over failed:', e));
    }

    function handleStepInto() {
        swDebugStepInto().catch(e => console.warn('[debug] step-into failed:', e));
    }

    function handleStepOut() {
        swDebugStepOut().catch(e => console.warn('[debug] step-out failed:', e));
    }

    function handleRestart() {
        // Stop current execution, then re-run in debug mode
        swTerminateExecution().catch(e => console.warn('[debug] terminate failed:', e));
        swDebugResume().catch(e => console.warn('[debug] resume failed:', e));
        dispatch({ type: 'RUN_STOP' });
        // Re-start is handled by the user clicking Debug again
    }

    function handleStop() {
        swTerminateExecution().catch(e => console.warn('[debug] terminate failed:', e));
        swDebugResume().catch(e => console.warn('[debug] resume failed:', e));
        dispatch({ type: 'RUN_STOP' });
    }

    return (
        <div id="debug-bar" data-testid="debug-bar">
            <button data-testid="debug-continue" title="Continue (F5)" onClick={handleContinue}><ContinueIcon size={14} /></button>
            <button data-testid="debug-step-over" title="Step Over (F10)" onClick={handleStepOver}><StepOverIcon size={14} /></button>
            <button data-testid="debug-step-into" title="Step Into (F11)" onClick={handleStepInto}><StepIntoIcon size={14} /></button>
            <button data-testid="debug-step-out" title="Step Out (Shift+F11)" onClick={handleStepOut}><StepOutIcon size={14} /></button>
            <span className="debug-bar-sep"></span>
            <button data-testid="debug-restart" title="Restart (Ctrl+Shift+F5)" onClick={handleRestart}><RestartIcon size={14} /></button>
            <button data-testid="debug-stop" title="Stop (Shift+F5)" onClick={handleStop}><DebugStopIcon size={14} /></button>
        </div>
    );
}

export default DebugBar;
