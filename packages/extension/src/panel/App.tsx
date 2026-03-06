import { useReducer, useRef, useEffect, useState } from 'react'
import Toolbar from './components/Toolbar'
import CodeMirrorEditorPane from "./components/CodeMirrorEditorPane"
import Splitter from './components/Splitter'
import TerminalPane from './components/TerminalPane'
import CommandInput, { CommandInputHandle } from './components/CommandInput'
import { panelReducer, initialState } from './reducer'
import { runAndDispatch } from './lib/run'
import { attachToTab, executeCommand, jsEval } from './lib/bridge'
import { Console, type ConsoleHandle } from './components/Console';
import { runCodeInSandbox } from '@/lib/sandbox-runner';

function App() {
  const [state, dispatch] = useReducer(panelReducer, initialState)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const cmdInputRef = useRef<CommandInputHandle>(null)
  const [bottomTab, setBottomTab] = useState<'terminal' | 'console'>('terminal');
  const consoleRef = useRef<ConsoleHandle>(null);


  async function doAttach(tabId: number) {
    dispatch({ type: 'ATTACH_START' });
    const res = await attachToTab(tabId);
    if (res.ok && res.url) dispatch({ type: 'ATTACH_SUCCESS', url: res.url, tabId });
    else dispatch({ type: 'ATTACH_FAIL' });
  }

  useEffect(() => {
    if (!chrome.tabs?.query) return;

    const params = new URLSearchParams(window.location.search);
    const tabIdParam = params.get('tabId');

    if (tabIdParam) {
      // Popup mode — attach to the specific tab passed in URL
      doAttach(Number(tabIdParam));
      return;
    }

    // Side panel mode — attach to current active tab, then follow tab switches
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) doAttach(tabId);
    });

    const onActivated = async (info: chrome.tabs.TabActiveInfo) => {
      const tab = await chrome.tabs.get(info.tabId).catch(() => null);
      const url = tab?.url ?? '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;
      doAttach(info.tabId);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, []);

  async function handleSubmit(command: string) {
    await runAndDispatch(command, dispatch);
    window.focus();
    cmdInputRef.current?.focus();
  }

  return (
    <>
      {/* Toolbar */}
      <Toolbar
        editorContent={state.editorContent}
        fileName={state.fileName}
        stepLine={state.stepLine}
        attachedUrl={state.attachedUrl}
        attachedTabId={state.attachedTabId}
        isAttaching={state.isAttaching}
        dispatch={dispatch}
      />

      {/* Editor pane */}
      <CodeMirrorEditorPane
         ref={editorPaneRef}
         editorContent={state.editorContent}
         currentRunLine={state.currentRunLine}
         lineResults={state.lineResults}
         dispatch={dispatch}
      />

      {/* Splitter */}
      <Splitter editorPaneRef={editorPaneRef}/>

      <div className="bottom-tab-bar">
        <button
          data-active={bottomTab === 'terminal'}
          onClick={() => setBottomTab('terminal')}
        >Terminal</button>
        <button
          data-active={bottomTab === 'console'}
          onClick={() => setBottomTab('console')}
        >Console</button>
        <div className="bottom-tab-spacer" />
        {bottomTab === 'console' && (
          <button
            className="console-clear-btn"
            onClick={() => consoleRef.current?.clear()}
            title="Clear console (Ctrl+L)"
          >⊘</button>
        )}
      </div>
      
      {bottomTab === 'terminal' ? (
        <>
          <TerminalPane
            outputLines={state.outputLines}
          />
          <CommandInput ref={cmdInputRef} onSubmit={handleSubmit} />
        </>
      ) : (
        <Console
          ref={consoleRef}
          executors={{
            pw: cmd => executeCommand(cmd),
            playwright: code => runCodeInSandbox(code),
            js: expr => jsEval(expr),
          }}
        />
      )}
    </>
  )
}

export default App
