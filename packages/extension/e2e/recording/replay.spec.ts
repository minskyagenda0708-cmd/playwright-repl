/**
 * Replay verification test — confirms that recorded output
 * works when replayed against real TodoMVC.
 */

import { test, expect } from '@playwright/test';

test.describe('Replay recorded commands', () => {
  test('hover + delete on TodoMVC', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/#/');
    await page.getByPlaceholder('What needs to be done?').fill('reading');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.getByPlaceholder('What needs to be done?').fill('learning');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.getByPlaceholder('What needs to be done?').fill('shopping');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.getByPlaceholder('What needs to be done?').fill('cooking');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Verify 4 items exist
    await expect(page.getByTestId('todo-item')).toHaveCount(4);

    // Delete with hover (recorded output)
    await page.getByText('reading').hover();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByText('learning').hover();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByText('shopping').hover();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByText('cooking').hover();
    await page.getByRole('button', { name: 'Delete' }).click();

    // All items deleted
    await expect(page.getByTestId('todo-item')).toHaveCount(0);
  });
});
