import { crx } from 'playwright-crx';
import type { CrxApplication, Page } from 'playwright-crx';
import { execute } from './commands';

let crxApp: CrxApplication | null = null;
let activePage: Page | null = null;
let activeTabId: number | null = null;

// Click extension icon → open side panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from side panel
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'attach') {
    attachToTab(msg.tabId).then(sendResponse);
    return true;
  }
  if (msg.type === 'run') {
    handleCommand(msg.command).then(sendResponse);
    return true;
  }
});

// ─── Navigation via Chrome APIs (bypasses Playwright lifecycle tracking) ───

function waitForTabLoad(tabId: number, timeout = 10000): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // resolve even on timeout — page is navigating, just slow
    }, timeout);
  });
}

async function getActiveTabId(): Promise<number | null> {
  if (activeTabId) return activeTabId;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function navigateTab(url: string): Promise<{ text: string; isError: boolean }> {
  const tabId = await getActiveTabId();
  if (!tabId) return { text: 'No active tab found.', isError: true };

  // If not yet attached, go to about:blank first (guaranteed clean attach), then navigate
  if (!activePage || activePage.isClosed()) {
    await chrome.tabs.update(tabId, { url: 'about:blank' });
    await waitForTabLoad(tabId, 2000);
    const result = await attachToTab(tabId);
    if (!result.ok) {
      return { text: `Cannot attach: ${result.error}`, isError: true };
    }
  }

  // Navigate via Chrome API — debugger attachment persists through navigation
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId);
  return { text: `Navigated to ${url}`, isError: false };
}

async function goBackTab(): Promise<{ text: string; isError: boolean }> {
  const tabId = await getActiveTabId();
  if (!tabId) return { text: 'No active tab found.', isError: true };
  await chrome.tabs.goBack(tabId);
  await waitForTabLoad(tabId);
  return { text: 'Went back', isError: false };
}

async function goForwardTab(): Promise<{ text: string; isError: boolean }> {
  const tabId = await getActiveTabId();
  if (!tabId) return { text: 'No active tab found.', isError: true };
  await chrome.tabs.goForward(tabId);
  await waitForTabLoad(tabId);
  return { text: 'Went forward', isError: false };
}

async function reloadTab(): Promise<{ text: string; isError: boolean }> {
  const tabId = await getActiveTabId();
  if (!tabId) return { text: 'No active tab found.', isError: true };
  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);
  return { text: 'Reloaded', isError: false };
}

async function attachToTab(tabId: number): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    // Check if tab is a chrome:// page (can't debug those)
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('chrome://')) {
      return { ok: false, error: 'Cannot attach to chrome:// pages. Navigate to a regular webpage first.' };
    }

    if (!crxApp) crxApp = await crx.start();

    // Detach previous tab if different
    if (activeTabId && activeTabId !== tabId) {
      try { await crxApp.detach(activeTabId); } catch { /* ignore */ }
    }

    activePage = await crxApp.attach(tabId);
    activeTabId = tabId;
    return { ok: true, url: activePage.url() };
  } catch (e) {
    activePage = null;
    // Keep activeTabId so we can retry later
    return { ok: false, error: String(e) };
  }
}

async function ensurePage(): Promise<Page | null> {
  if (activePage && !activePage.isClosed()) return activePage;

  // Re-attach if page was lost, or auto-attach to active tab
  const tabId = await getActiveTabId();
  if (tabId) {
    const result = await attachToTab(tabId);
    if (result.ok) return activePage;
  }
  return null;
}

async function handleCommand(command: string) {
  const [keyword, ...args] = command.trim().split(/\s+/);

  // Navigation commands use Chrome APIs (Playwright's page.goto times out via CrxTransport)
  if (keyword === 'goto') {
    let url = args.join(' ');
    if (!url) return { text: 'Usage: goto <url>', isError: true };
    if (!url.startsWith('http')) url = `https://${url}`;
    return navigateTab(url);
  }
  if (keyword === 'back') return goBackTab();
  if (keyword === 'forward') return goForwardTab();
  if (keyword === 'reload') return reloadTab();

  const page = await ensurePage();
  if (!page) {
    return { text: 'Not attached to any tab. Click the connection indicator to reconnect.', isError: true };
  }
  return await execute(command, page);
}
