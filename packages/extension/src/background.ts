import { crx } from '@playwright-repl/playwright-crx';
import type { CrxApplication } from '@playwright-repl/playwright-crx';
import type { Page } from '@playwright-repl/playwright-crx/test';
import { parseReplCommand } from './commands';
import type { TabOperation } from './commands';
import { loadSettings } from './panel/lib/settings';
import type { PwReplSettings } from './panel/lib/settings';

// ─── Settings + Action (sidepanel / popup) ───────────────────────────────────

// Disable auto-open so action.onClicked fires (Chrome persists this across reloads)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

let cachedSettings: PwReplSettings = { openAs: 'sidepanel' };
loadSettings().then(s => cachedSettings = s).catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.openAs) {
    cachedSettings.openAs = changes.openAs.newValue;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (cachedSettings.openAs === 'sidepanel') {
    await chrome.sidePanel.open({ windowId: tab.windowId! });
  } else {
    const tabId = tab.id;
    await chrome.windows.create({
      url: chrome.runtime.getURL('panel/panel.html') + (tabId ? `?tabId=${tabId}` : ''),
      type: 'popup',
      width: 450,
      height: 700,
    });
  }
});

// ─── playwright-crx State ────────────────────────────────────────────────────

let crxApp: CrxApplication | null = null;
let currentPage: Page | null = null;
let activeTabId: number | null = null;

async function getActiveTabId(): Promise<number | null> {
  if (activeTabId) return activeTabId;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

// ─── Tab Attachment ───────────────────────────────────────────────────────────

async function attachToTab(tabId: number): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      return { ok: false, error: 'Cannot attach to internal pages. Navigate to a regular webpage first.' };
    }

    if (!crxApp) crxApp = await crx.start();

    // Always detach first — stale frame connections cause "Frame has been detached" errors
    // (e.g. GitHub SPA navigation replaces frames within the same tab)
    if (activeTabId !== null) {
      await crxApp.detach(activeTabId).catch(() => {});
      currentPage = null;
      activeTabId = null;
    }

    // Retry once on "Frame has been detached" — can happen with SPA navigation
    try {
      currentPage = await crxApp.attach(tabId);
    } catch (e) {
      if (String(e).includes('Frame') && String(e).includes('detached')) {
        await new Promise(r => setTimeout(r, 500));
        currentPage = await crxApp.attach(tabId);
      } else {
        throw e;
      }
    }
    activeTabId = tabId;
    return { ok: true, url: currentPage.url() };
  } catch (e) {
    activeTabId = null;
    currentPage = null;
    return { ok: false, error: String(e) };
  }
}

async function ensurePage(): Promise<Page | null> {
  if (currentPage) return currentPage;
  const tabId = await getActiveTabId();
  if (tabId) {
    const result = await attachToTab(tabId);
    if (result.ok) return currentPage;
  }
  return null;
}

// ─── Command Execution ───────────────────────────────────────────────────────

interface CommandResult {
  text: string;
  isError: boolean;
  image?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Command timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

async function handleTabOp(op: string, tabArgs: Record<string, unknown>): Promise<CommandResult> {
  try {
    if (op === 'list') {
      const tabs = await chrome.tabs.query({});
      const list = tabs.map(t => `[${t.id}] ${t.title ?? ''} — ${t.url ?? ''}`).join('\n');
      return { text: list || '(no tabs)', isError: false };
    }
    if (op === 'new') {
      const tab = await chrome.tabs.create({ url: (tabArgs.url as string) || 'about:blank' });
      return { text: `Opened tab ${tab.id}`, isError: false };
    }
    if (op === 'close') {
      const tabId = (tabArgs.tabId as number) ?? activeTabId;
      if (!tabId) return { text: 'No tab id specified', isError: true };
      await chrome.tabs.remove(tabId);
      if (tabId === activeTabId) { activeTabId = null; currentPage = null; }
      return { text: `Closed tab ${tabId}`, isError: false };
    }
    if (op === 'select') {
      const tabId = tabArgs.tabId as number;
      if (!tabId) return { text: 'No tab id specified', isError: true };
      await chrome.tabs.update(tabId, { active: true });
      activeTabId = tabId;
      return { text: `Selected tab ${tabId}`, isError: false };
    }
    return { text: `Unknown tab op: ${op}`, isError: true };
  } catch (e) {
    return { text: String(e), isError: true };
  }
}

async function handleCommand(command: string): Promise<CommandResult> {
  const parsed = parseReplCommand(command);

  if ('help' in parsed) return { text: parsed.help, isError: false };
  if ('error' in parsed) return { text: parsed.error, isError: true };

  if ('tabOp' in parsed) {
    return handleTabOp((parsed as TabOperation).tabOp, (parsed as TabOperation).tabArgs);
  }

  const page = await ensurePage();
  if (!page) {
    return { text: 'Not attached to any tab. Click Attach to connect.', isError: true };
  }

  try {
    const result = await withTimeout(parsed.fn(page, ...parsed.fnArgs), 15000);
    if (result && typeof result === 'object' && '__image' in result) {
      return { text: '', image: `data:${result.mimeType};base64,${result.__image}`, isError: false };
    }
    return { text: result != null ? String(result) : 'Done', isError: false };
  } catch (e) {
    return { text: String(e), isError: true };
  }
}

// ─── Recording ───────────────────────────────────────────────────────────────

async function startRecording(): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    if (!crxApp) crxApp = await crx.start();

    const tabId = await getActiveTabId();
    if (tabId && crxApp.context().pages().length === 0) await attachToTab(tabId);

    const url = crxApp.context().pages()[0]?.url();

    await crxApp.recorder.show({
      mode: 'recording',
      language: 'javascript',
      window: { type: 'sidepanel', url: 'panel/panel.html' },
    });

    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function stopRecording(): Promise<{ ok: boolean }> {
  await crxApp?.recorder.hide().catch(() => {});
  return { ok: true };
}

// ─── Page call (sandbox iframe → background) ─────────────────────────────────

async function handlePageCall(chain: { method: string; args: unknown[] }[]): Promise<{ result?: unknown; error?: string }> {
  const page = await ensurePage();
  if (!page) return { error: 'Not attached to any tab. Click Attach to connect.' };
  try {
    let obj: any = page;
    for (const { method, args } of chain) {
      const fn = obj[method];
      if (typeof fn !== 'function') return { error: `${method} is not a function` };
      obj = await fn.apply(obj, args);
    }
    // Only serialize plain data — class instances (Locator, Response) return null
    const isPlainData = obj == null || typeof obj !== 'object' || Array.isArray(obj) || Object.getPrototypeOf(obj) === Object.prototype;
    if (!isPlainData) return { result: null };
    try {
      return { result: JSON.parse(JSON.stringify(obj)) };
    } catch {
      return { result: null };
    }
  } catch (e) {
    return { error: String(e) };
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'run')          { handleCommand(msg.command).then(sendResponse); return true; }
  if (msg.type === 'attach')       { attachToTab(msg.tabId).then(sendResponse); return true; }
  if (msg.type === 'health')       { sendResponse({ ok: !!crxApp }); return false; }
  if (msg.type === 'record-start') { startRecording().then(sendResponse); return true; }
  if (msg.type === 'record-stop')  { stopRecording().then(sendResponse); return true; }
  if (msg.type === 'page-call')    { handlePageCall(msg.chain).then(sendResponse); return true; }
});
