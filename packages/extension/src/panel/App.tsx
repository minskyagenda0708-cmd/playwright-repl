import { useReducer, useRef, useEffect } from 'react'
import Toolbar from './components/Toolbar'
import CodeMirrorEditorPane from "./components/CodeMirrorEditorPane"
import Splitter from './components/Splitter'
import ConsolePane from './components/ConsolePane'
import CommandInput, { CommandInputHandle } from './components/CommandInput'
import { panelReducer, initialState } from './reducer'
import { runAndDispatch } from './lib/run'
import { attachToTab } from './lib/bridge'

function App() {
  const [state, dispatch] = useReducer(panelReducer, initialState)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const cmdInputRef = useRef<CommandInputHandle>(null)

  async function doAttach(tabId: number) {
    dispatch({ type: 'ATTACH_START' });
    const res = await attachToTab(tabId);
    if (res.ok && res.url) dispatch({ type: 'ATTACH_SUCCESS', url: res.url });
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

    const onActivated = (info: chrome.tabs.TabActiveInfo) => doAttach(info.tabId);
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

      {/* Console pane */}
      <ConsolePane
         outputLines={state.outputLines}
         passCount={state.passCount}
         failCount={state.failCount}
         dispatch={dispatch}
      />

      {/* Command input — lives outside ConsolePane so its CM view is unaffected by console re-renders */}
      <CommandInput ref={cmdInputRef} onSubmit={handleSubmit} />
    </>
  )
}

export default App
