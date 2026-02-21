/**
 * Recording integration E2E tests.
 *
 * Tests the full recording pipeline with the real extension:
 *   recorder.js (content script) → chrome.runtime.sendMessage → panel.js
 *
 * Key challenge: In E2E tests the panel runs as a regular tab
 * (not a real side panel), so we trigger recording via the service worker
 * directly rather than clicking the Record button (which queries the active tab).
 */

import { test, expect } from './fixtures.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Start recording on the target page by calling startRecording()
 * directly in the service worker context.
 */
async function startRecordingOn(sw, targetPage) {
  const targetUrl = targetPage.url();
  const result = await sw.evaluate(async (url) => {
    // Find the target tab by URL
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url && t.url.startsWith(url));
    if (!tab) return { ok: false, error: 'Target tab not found for ' + url };
    // Call startRecording directly (defined in background.js scope)
    return await startRecording(tab.id);
  }, targetUrl);
  return result;
}

/**
 * Stop recording on the target page.
 */
async function stopRecordingOn(sw, targetPage) {
  const targetUrl = targetPage.url();
  return await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url && t.url.startsWith(url));
    if (!tab) return { ok: true };
    return await stopRecording(tab.id);
  }, targetUrl);
}

/**
 * Wait for a command matching a pattern to appear in the panel's editor.
 */
async function waitForRecordedCommand(panelPage, pattern, timeoutMs = 10000) {
  await panelPage.waitForFunction(
    ([pat]) => {
      const editor = document.getElementById('editor');
      return editor && new RegExp(pat).test(editor.value);
    },
    [pattern],
    { timeout: timeoutMs },
  );
}

/**
 * Wait for a command matching a pattern to appear in the panel's console output.
 */
async function waitForConsoleCommand(panelPage, pattern, timeoutMs = 10000) {
  await panelPage.waitForFunction(
    ([pat]) => {
      const cmds = document.querySelectorAll('.line-command');
      return [...cmds].some(el => new RegExp(pat).test(el.textContent));
    },
    [pattern],
    { timeout: timeoutMs },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('recorder injects and captures a click on a link', async ({ recordingPages }) => {
  const { panelPage, targetPage, sw } = recordingPages;

  // Start recording on the target page
  const result = await startRecordingOn(sw, targetPage);
  expect(result.ok).toBe(true);

  // Bring target page to front and click the link
  await targetPage.bringToFront();
  await targetPage.locator('a').first().click();

  // The recorder should capture the click and send it to the panel
  await panelPage.bringToFront();
  await waitForConsoleCommand(panelPage, 'click');

  // Verify it also appeared in the editor
  const editorValue = await panelPage.locator('#editor').inputValue();
  expect(editorValue).toContain('click');

  await stopRecordingOn(sw, targetPage);
});

test('recorder captures input/fill events', async ({ recordingPages }) => {
  const { panelPage, targetPage, sw } = recordingPages;

  // Navigate to a page with an input field
  await targetPage.goto('https://demo.playwright.dev/todomvc/');
  await targetPage.waitForLoadState('domcontentloaded');

  const result = await startRecordingOn(sw, targetPage);
  expect(result.ok).toBe(true);

  // Type into the input field — recorder debounces fill after 1500ms
  await targetPage.bringToFront();
  const input = targetPage.locator('.new-todo');
  await input.fill('Buy groceries');

  // Wait for the debounced fill to flush (1500ms debounce + buffer)
  await targetPage.waitForTimeout(2500);

  await panelPage.bringToFront();
  await waitForConsoleCommand(panelPage, 'fill.*Buy groceries');

  const editorValue = await panelPage.locator('#editor').inputValue();
  expect(editorValue).toContain('fill');
  expect(editorValue).toContain('Buy groceries');

  await stopRecordingOn(sw, targetPage);
});

test('recorder captures keyboard press events', async ({ recordingPages }) => {
  const { panelPage, targetPage, sw } = recordingPages;

  // Navigate to a page with an input
  await targetPage.goto('https://demo.playwright.dev/todomvc/');
  await targetPage.waitForLoadState('domcontentloaded');

  const result = await startRecordingOn(sw, targetPage);
  expect(result.ok).toBe(true);

  // Type and press Enter
  await targetPage.bringToFront();
  const input = targetPage.locator('.new-todo');
  await input.fill('Test item');
  await input.press('Enter');

  await panelPage.bringToFront();
  await waitForConsoleCommand(panelPage, 'press Enter');

  const editorValue = await panelPage.locator('#editor').inputValue();
  expect(editorValue).toContain('press Enter');

  await stopRecordingOn(sw, targetPage);
});

test('stop recording cleans up — no more commands captured', async ({ recordingPages }) => {
  const { panelPage, targetPage, sw } = recordingPages;

  const result = await startRecordingOn(sw, targetPage);
  expect(result.ok).toBe(true);

  // Click while recording — should be captured
  await targetPage.bringToFront();
  await targetPage.locator('a').first().click();
  await panelPage.bringToFront();
  await waitForConsoleCommand(panelPage, 'click');

  // Stop recording
  await stopRecordingOn(sw, targetPage);

  // Clear editor to check for new commands
  await panelPage.evaluate(() => {
    document.getElementById('editor').value = '';
  });

  // Navigate back and click again — should NOT be captured
  await targetPage.bringToFront();
  await targetPage.goBack();
  await targetPage.waitForLoadState('domcontentloaded');
  await targetPage.locator('a').first().click();

  // Wait a bit and verify no new commands appeared in editor
  await panelPage.bringToFront();
  await panelPage.waitForTimeout(2000);
  const editorValue = await panelPage.locator('#editor').inputValue();
  expect(editorValue).toBe('');
});

test('recorder re-injects after page navigation', async ({ recordingPages }) => {
  const { panelPage, targetPage, sw } = recordingPages;

  const result = await startRecordingOn(sw, targetPage);
  expect(result.ok).toBe(true);

  // Click a link that navigates to a new page
  await targetPage.bringToFront();
  await targetPage.locator('a').first().click();
  await targetPage.waitForLoadState('domcontentloaded');

  // Wait for re-injection (tabs.onUpdated fires on 'complete')
  await targetPage.waitForTimeout(1000);

  // Clear the editor to isolate new commands
  await panelPage.bringToFront();
  await panelPage.evaluate(() => {
    document.getElementById('editor').value = '';
  });

  // Now interact with the new page — recorder should still work
  await targetPage.bringToFront();

  // Press Tab on the new page to trigger a keyboard event
  await targetPage.keyboard.press('Tab');

  await panelPage.bringToFront();
  await waitForConsoleCommand(panelPage, 'press Tab');

  await stopRecordingOn(sw, targetPage);
});
