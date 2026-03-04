import { useState, useEffect } from 'react';
import { loadSettings, storeSettings } from '../panel/lib/settings';
import type { PwReplSettings } from '../panel/lib/settings';

export default function PreferencesForm() {
  const [settings, setSettings] = useState<PwReplSettings>({ openAs: 'sidepanel' });

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  function handleChange(openAs: PwReplSettings['openAs']) {
    const next = { ...settings, openAs };
    setSettings(next);
    storeSettings(next);
  }

  return (
    <form style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', maxWidth: '400px' }}>
      <h2 style={{ marginTop: 0 }}>Playwright REPL Preferences</h2>
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: '12px' }}>Open REPL as:</legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="openAs"
            value="sidepanel"
            checked={settings.openAs === 'sidepanel'}
            onChange={() => handleChange('sidepanel')}
          />
          Side Panel (default)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="openAs"
            value="popup"
            checked={settings.openAs === 'popup'}
            onChange={() => handleChange('popup')}
          />
          Popup Window
        </label>
      </fieldset>
      <p style={{ marginTop: '16px', fontSize: '12px', color: '#888' }}>Saved automatically.</p>
    </form>
  );
}
