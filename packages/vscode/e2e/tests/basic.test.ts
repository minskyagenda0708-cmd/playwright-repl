/**
 * Basic E2E tests for the Playwright REPL VS Code extension.
 */
import { test, expect } from './baseTest';

test('VS Code window opens', async ({ workbox }) => {
  // VS Code's title bar should be visible
  await expect(workbox.locator('.monaco-workbench')).toBeVisible({ timeout: 30_000 });
});

test('extension activates — Testing sidebar available', async ({ workbox }) => {
  // Click the Testing icon in the activity bar
  await workbox.getByRole('tab', { name: /Testing/i }).click();
  // Test Explorer and Playwright REPL sections should appear
  await expect(workbox.getByText('TEST EXPLORER')).toBeVisible({ timeout: 15_000 });
  await expect(workbox.getByText('PLAYWRIGHT REPL')).toBeAttached({ timeout: 5_000 });
});

test('REPL, Locator, and Assert panels are registered', async ({ workbox }) => {
  // TODO(#526): keyboard shortcuts don't work reliably on Linux/macOS CI
  test.skip(!!process.env.CI, 'Keyboard shortcuts unreliable on CI — fix in follow-up');
  // Click editor area to ensure focus, then open bottom panel
  await workbox.locator('.editor-group-container').first().click({ force: true }).catch(() => {});
  await workbox.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`');
  // REPL, Locator, and Assert tabs should exist in the DOM
  await expect(workbox.getByRole('tab', { name: 'REPL' })).toBeAttached({ timeout: 15_000 });
  await expect(workbox.getByRole('tab', { name: 'LOCATOR' })).toBeAttached({ timeout: 5_000 });
  await expect(workbox.getByRole('tab', { name: 'ASSERT' })).toBeAttached({ timeout: 5_000 });
});
