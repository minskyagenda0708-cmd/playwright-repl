// ─── General Settings ───────────────────────────────────────────────────────

export type PwReplSettings = {
    openAs: 'sidepanel' | 'popup',
    relayPort: number,
    languageMode: 'pw' | 'js',
    commandTimeout: number,
};

const DEFAULT: PwReplSettings = { openAs: 'sidepanel', relayPort: 9877, languageMode: 'pw', commandTimeout: 15000 };

export async function loadSettings(): Promise<PwReplSettings> {
    const stored = await chrome.storage.local.get(['openAs', 'relayPort', 'languageMode', 'commandTimeout']) as Partial<PwReplSettings>;
    return { ...DEFAULT, ...stored };
}

export async function storeSettings(s: PwReplSettings): Promise<void> {
    await chrome.storage.local.set(s);
}

