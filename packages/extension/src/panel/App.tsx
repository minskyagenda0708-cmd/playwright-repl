import { useReducer, useRef, useEffect, useState } from 'react'
import Toolbar from './components/Toolbar'
import CodeMirrorEditorPane from "./components/CodeMirrorEditorPane"
import Splitter from './components/Splitter'
import ConsolePane from './components/ConsolePane'
import CommandInput, { CommandInputHandle } from './components/CommandInput'
import { panelReducer, initialState } from './reducer'
import { runAndDispatch, setTabUrl } from './lib/run'
import { selectTab } from './lib/server'

function App() {
  const [state, dispatch ] = useReducer(panelReducer, initialState)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const cmdInputRef = useRef<CommandInputHandle>(null)
  const [attachedTabUrl, setAttachedTabUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!chrome.tabs?.onActivated) return;
    // In popup mode (?tabId=X), stay attached to the original tab — don't follow Chrome tab switches.
    const isPopup = new URLSearchParams(window.location.search).has('tabId');
    if (isPopup) return;
    const onActivated = (info: chrome.tabs.TabActiveInfo) => {
      chrome.tabs.get(info.tabId, (tab) => {
        const url = tab?.url;
        if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;
        setTabUrl(url);
        setAttachedTabUrl(url);
        selectTab(url);
      });
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabId = params.get('tabId');
    if (tabId) {
      // Popup mode — attach to the tab passed in the URL
      chrome.tabs.get(Number(tabId), (tab) => {
        if (chrome.runtime.lastError || !tab?.url) return;
        setTabUrl(tab.url);
        setAttachedTabUrl(tab.url);
      });
    } else {
      // Side panel mode — initialize from the currently active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs[0]?.url;
        if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;
        setTabUrl(url);
        setAttachedTabUrl(url);
      });
    }
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
        dispatch={dispatch}
        attachedTabUrl={attachedTabUrl}
        onTabChange={(url: string) => { setTabUrl(url); setAttachedTabUrl(url); selectTab(url).then(() => window.focus()); }}
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
