/**
 * background.js — Service worker for the Playwright REPL DevTools extension.
 *
 * Roles:
 *   1. CDP bridge: Handles connect.html flow from Playwright's CDPRelayServer,
 *      bridging chrome.debugger via RelayConnection (copied from MCP Bridge)
 *   2. Command proxy: forward panel commands to CommandServer via HTTP POST /run
 *   3. Recording: inject recorder.js, listen for __pw: events (extension-side only)
 */

import { RelayConnection, debugLog } from './lib/relayConnection.js';

// ─── State ───────────────────────────────────────────────────────────────────

let serverPort = 3000;
let panelPorts = {};     // tabId → port (for sending recorded commands to panel)
let recording = {};      // tabId → boolean

// ─── MCP Bridge relay (matches TabShareExtension from Playwright MCP Bridge) ─

let activeConnection = null;
let connectedTabId = null;
const pendingTabSelection = new Map(); // selectorTabId → { connection, timerId? }

// ─── Message handling (MCP Bridge + panel commands) ──────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // MCP Bridge messages (from connect.html)
  if (message.type === 'connectToMCPRelay') {
    connectToRelay(sender.tab.id, message.mcpRelayUrl).then(
      () => sendResponse({ success: true }),
      (error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'getTabs') {
    getTabs().then(
      tabs => sendResponse({ success: true, tabs, currentTabId: sender.tab?.id }),
      (error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'connectToTab') {
    const tabId = message.tabId || sender.tab?.id;
    const windowId = message.windowId || sender.tab?.windowId;
    connectTab(sender.tab.id, tabId, windowId, message.mcpRelayUrl).then(
      () => sendResponse({ success: true }),
      (error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'getConnectionStatus') {
    sendResponse({ connectedTabId });
    return false;
  }

  if (message.type === 'disconnect') {
    disconnect().then(
      () => sendResponse({ success: true }),
      (error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Panel commands (from DevTools panel)
  if (message.type === 'pw-command') {
    handlePanelCommand(message.raw).then(sendResponse);
    return true;
  }

  if (message.type === 'pw-record-start') {
    startRecording(message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === 'pw-record-stop') {
    stopRecording(message.tabId).then(sendResponse);
    return true;
  }
});

// ─── MCP Bridge relay functions ─────────────────────────────────────────────

async function connectToRelay(selectorTabId, mcpRelayUrl) {
  try {
    debugLog(`Connecting to relay at ${mcpRelayUrl}`);
    const socket = new WebSocket(mcpRelayUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('WebSocket error'));
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const connection = new RelayConnection(socket);
    connection.onclose = () => {
      debugLog('Connection closed');
      pendingTabSelection.delete(selectorTabId);
    };
    pendingTabSelection.set(selectorTabId, { connection });
    debugLog(`Connected to MCP relay`);
  } catch (error) {
    const message = `Failed to connect to MCP relay: ${error.message}`;
    debugLog(message);
    throw new Error(message);
  }
}

async function connectTab(selectorTabId, tabId, windowId, mcpRelayUrl) {
  try {
    debugLog(`Connecting tab ${tabId} to relay at ${mcpRelayUrl}`);
    try {
      activeConnection?.close('Another connection is requested');
    } catch (error) {
      debugLog(`Error closing active connection:`, error);
    }
    await setConnectedTabId(null);

    activeConnection = pendingTabSelection.get(selectorTabId)?.connection;
    if (!activeConnection)
      throw new Error('No active MCP relay connection');
    pendingTabSelection.delete(selectorTabId);

    activeConnection.setTabId(tabId);
    activeConnection.onclose = () => {
      debugLog('MCP connection closed');
      activeConnection = null;
      void setConnectedTabId(null);
    };

    await Promise.all([
      setConnectedTabId(tabId),
      chrome.tabs.update(tabId, { active: true }),
      chrome.windows.update(windowId, { focused: true }),
    ]);
    debugLog(`Connected to MCP bridge`);
  } catch (error) {
    await setConnectedTabId(null);
    debugLog(`Failed to connect tab ${tabId}:`, error.message);
    throw error;
  }
}

async function setConnectedTabId(tabId) {
  const oldTabId = connectedTabId;
  connectedTabId = tabId;
  if (oldTabId && oldTabId !== tabId)
    await updateBadge(oldTabId, { text: '' });
  if (tabId)
    await updateBadge(tabId, { text: '\u2713', color: '#4CAF50', title: 'Connected to MCP client' });
}

async function updateBadge(tabId, { text, color, title }) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setTitle({ tabId, title: title || '' });
    if (color)
      await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (error) {
    // Ignore errors as the tab may be closed already.
  }
}

async function getTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => tab.url && !['chrome:', 'edge:', 'devtools:'].some(scheme => tab.url.startsWith(scheme)));
}

async function disconnect() {
  activeConnection?.close('User disconnected');
  activeConnection = null;
  await setConnectedTabId(null);
}

// ─── Tab lifecycle ──────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  const pendingConn = pendingTabSelection.get(tabId)?.connection;
  if (pendingConn) {
    pendingTabSelection.delete(tabId);
    pendingConn.close('Browser tab closed');
    return;
  }
  if (connectedTabId !== tabId) return;
  activeConnection?.close('Browser tab closed');
  activeConnection = null;
  connectedTabId = null;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (connectedTabId === tabId)
    void setConnectedTabId(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  for (const [tabId, pending] of pendingTabSelection) {
    if (tabId === activeInfo.tabId) {
      if (pending.timerId) {
        clearTimeout(pending.timerId);
        pending.timerId = undefined;
      }
      continue;
    }
    if (!pending.timerId) {
      pending.timerId = setTimeout(() => {
        const existed = pendingTabSelection.delete(tabId);
        if (existed) {
          pending.connection.close('Tab has been inactive for 5 seconds');
          chrome.tabs.sendMessage(tabId, { type: 'connectionTimeout' });
        }
      }, 5000);
      return;
    }
  }
});

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('connect.html'),
    active: true,
  });
});

// ─── Panel command handling ──────────────────────────────────────────────────

async function handlePanelCommand(raw) {
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    return await res.json();
  } catch (e) {
    return { text: 'Not connected to server. Run: playwright-repl --extension', isError: true };
  }
}

// ─── Recording ───────────────────────────────────────────────────────────────

let recordingAttachedTabId = null;

async function startRecording(tabId) {
  try {
    await ensureAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    const recorderCode = await fetch(chrome.runtime.getURL('content/recorder.js')).then(r => r.text());
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Page.addScriptToEvaluateOnNewDocument', {
      source: recorderCode,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: recorderCode,
      returnByValue: false,
    });
    recording[tabId] = true;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function stopRecording(tabId) {
  recording[tabId] = false;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: 'window.__pwRecorderCleanup && window.__pwRecorderCleanup()',
      returnByValue: false,
    });
  } catch (e) {
    // Page might have navigated
  }
  return { success: true };
}

async function ensureAttached(tabId) {
  if (recordingAttachedTabId === tabId) return;
  if (recordingAttachedTabId) {
    try { await chrome.debugger.detach({ tabId: recordingAttachedTabId }); } catch (e) {}
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  recordingAttachedTabId = tabId;
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === recordingAttachedTabId) {
    recordingAttachedTabId = null;
    recording[source.tabId] = false;
  }
});

// ─── CDP event forwarding (for recording only) ─────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== recordingAttachedTabId) return;
  if (method === 'Runtime.consoleAPICalled' && params?.type === 'debug') {
    const text = params.args?.[0]?.value || '';
    if (text.startsWith('__pw:')) {
      const command = text.slice(5);
      const port = panelPorts[recordingAttachedTabId];
      if (port) port.postMessage({ type: 'pw-recorded-command', command });
    }
  }
});

// ─── Panel port management ──────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('pw-panel-')) return;
  const tabId = parseInt(port.name.replace('pw-panel-', ''), 10);
  panelPorts[tabId] = port;

  port.onDisconnect.addListener(() => {
    delete panelPorts[tabId];
  });
});

// ─── Exports (for testing) ──────────────────────────────────────────────────

export {
  handlePanelCommand,
  startRecording,
  stopRecording,
  ensureAttached,
  connectToRelay,
  connectTab,
  disconnect,
};

export function _getState() {
  return { serverPort, panelPorts, recording, activeConnection, connectedTabId, recordingAttachedTabId, pendingTabSelection };
}

export function _resetState() {
  panelPorts = {};
  recording = {};
  activeConnection = null;
  connectedTabId = null;
  recordingAttachedTabId = null;
  pendingTabSelection.clear();
}
