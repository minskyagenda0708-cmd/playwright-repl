import { test, expect } from '@playwright/test';

test('should pass', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
