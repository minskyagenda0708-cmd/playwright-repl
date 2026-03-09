export type PwReplSettings = {
    openAs: 'sidepanel' | 'popup',
    bridgePort: number, 
};

const DEFAULT: PwReplSettings = { openAs: 'sidepanel', bridgePort: 9876 };

export async function loadSettings(): Promise<PwReplSettings> {
    const stored = await chrome.storage.local.get(['openAs', 'bridgePort']) as Partial<PwReplSettings>;
    return { ...DEFAULT, ...stored };
}

export async function storeSettings(s: PwReplSettings): Promise<void> {
    await chrome.storage.local.set(s);
}