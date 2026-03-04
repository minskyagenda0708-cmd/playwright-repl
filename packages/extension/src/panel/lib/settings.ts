export type PwReplSettings = {
    openAs: 'sidepanel' | 'popup'
};

const DEFAULT: PwReplSettings = { openAs: 'sidepanel' };

export async function loadSettings(): Promise<PwReplSettings> {
    const stored = await chrome.storage.local.get(['openAs']) as Partial<PwReplSettings>;
    return { ...DEFAULT, ...stored };
}

export async function storeSettings(s: PwReplSettings): Promise<void> {
    await chrome.storage.local.set(s);
}