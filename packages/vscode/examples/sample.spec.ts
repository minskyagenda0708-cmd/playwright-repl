import { test, expect } from '@playwright/test';

test.describe('Example Domain', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://example.com');
  });

  test('has correct title', async ({ page }) => {
    await expect(page).toHaveTitle('Example Domain');
  });

  test('has heading', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Example Domain');
  });

  test('has link', async ({ page }) => {
    const link = page.locator('a');
    await expect(link).toHaveText('Learn more');
  });
});
