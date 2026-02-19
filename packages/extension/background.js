/**
 * background.js — Service worker for the Playwright REPL DevTools extension.
 *
 * Three roles:
 *   1. CDP bridge: WebSocket connection to CommandServer, bridging chrome.debugger
 *      so Playwright can control the inspected tab via connectOverCDP
 *   2. Command proxy: forward panel commands to CommandServer via HTTP POST /run
 *   3. Recording: inject recorder.js, listen for __pw: events (extension-side only)
 */

import { RelayConnection } from './lib/relayConnection.js';

// ─── State ───────────────────────────────────────────────────────────────────

let serverPort = 3000;
let panelPorts = {};     // tabId → port (for sending recorded commands to panel)
let recording = {};      // tabId → boolean
let activeRelay = null;  // RelayConnection instance

// ─── Bridge connection ──────────────────────────────────────────────────────

function connectBridge(tabId) {
  if (activeRelay) return;

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/extension`);
    ws.onopen = () => {
      activeRelay = new RelayConnection(ws, tabId);
      activeRelay.onclose = () => { activeRelay = null; };
      console.log('[bridge] Connected to server, tabId:', tabId);
    };
    ws.onerror = () => {
      // Server not running yet, will retry when panel reconnects
    };
    ws.onclose = () => {
      if (activeRelay) return; // RelayConnection handles its own cleanup
      // Auto-reconnect after delay if no active relay
      setTimeout(() => connectBridge(tabId), 2000);
    };
  } catch (e) {
    // WebSocket constructor failed
  }
}

// ─── Panel command handling ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

// ─── Debugger attach/detach (for recording only) ────────────────────────────

let recordingAttachedTabId = null;

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

  // When a panel connects, start the CDP bridge for this tab
  connectBridge(tabId);

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
  connectBridge,
};

export function _getState() {
  return { serverPort, panelPorts, recording, activeRelay, recordingAttachedTabId };
}

export function _resetState() {
  panelPorts = {};
  recording = {};
  activeRelay = null;
  recordingAttachedTabId = null;
}

export function _setActiveRelay(relay) {
  activeRelay = relay;
}
