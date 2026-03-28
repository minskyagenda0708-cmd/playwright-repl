/**
 * DevTools REPL Console — mounts the Console component in a DevTools panel.
 */
import '../panel/panel.css';
import { createRoot } from 'react-dom/client';
import { useReducer, useEffect } from 'react';
import { panelReducer, initialState } from '../panel/reducer';
import { attachToTab } from '../panel/lib/bridge';
import { Console } from '../panel/components/Console';
import { onConsoleEvent } from '../panel/lib/sw-debugger';

function DevToolsConsole() {
  const [state, dispatch] = useReducer(panelReducer, initialState);

  // Auto-attach to the inspected tab
  useEffect(() => {
    if (chrome.devtools?.inspectedWindow) {
      const tabId = chrome.devtools.inspectedWindow.tabId;
      attachToTab(tabId).then(res => {
        if (res.ok && res.url)
          dispatch({ type: 'ATTACH_SUCCESS', url: res.url, tabId });
      }).catch(() => {});
    }
  }, []);

  // Forward console.log/error from the page
  useEffect(() => {
    onConsoleEvent((level, args) => {
      for (const arg of args) {
        const type = level === 'error' ? 'error' : level === 'warn' ? 'info' : 'success';
        dispatch({ type: 'ADD_LINE', line: { text: '', type, value: arg } });
      }
    });
    return () => onConsoleEvent(null);
  }, [dispatch]);

  return <Console outputLines={state.outputLines} dispatch={dispatch} />;
}

createRoot(document.getElementById('root')!).render(<DevToolsConsole />);
