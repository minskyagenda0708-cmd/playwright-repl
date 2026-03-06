export type CommandResult = { text: string; isError: boolean; image?: string };

export async function executeCommand(command: string): Promise<CommandResult> {
  return chrome.runtime.sendMessage({ type: 'run', command });
}

export async function attachToTab(tabId: number): Promise<{ ok: boolean; url?: string; error?: string }> {
  return chrome.runtime.sendMessage({ type: 'attach', tabId });
}

/**
 * Connects to the background service worker's recorder port with retry.
 * The port may not be ready immediately after record-start.
 */
export function connectWithRetry(maxRetries = 20, delay = 150): Promise<chrome.runtime.Port> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryConnect() {
      attempt++;
      const port = chrome.runtime.connect();
      let settled = false;
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError?.message;
        if (settled) return;
        settled = true;
        if (attempt < maxRetries) setTimeout(tryConnect, delay);
        else reject(new Error('Could not connect to recorder after retries'));
      });
      setTimeout(() => { if (!settled) { settled = true; resolve(port); } }, 100);
    }
    tryConnect();
  });
}

export async function jsEval(expr: string): Promise<{ value?: unknown; text?: string; isError: boolean }> {
  return chrome.runtime.sendMessage({ type: 'js-eval', expr });
}
