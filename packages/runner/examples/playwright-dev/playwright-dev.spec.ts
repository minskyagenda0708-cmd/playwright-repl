import { test, expect } from '@playwright/test';

test.describe('Playwright website', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://playwright.dev/');
  });

  test('has title', async ({ page }) => {
    await expect(page).toHaveTitle(/Playwright/);
  });

  test('has get started link', async ({ page }) => {
    await page.getByRole('link', { name: 'Get started' }).click();
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  });

  test('has search', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox')).toBeVisible();
  });

  test('has navigation', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'API' })).toBeVisible();
  });

  test('has community link', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Community' })).toBeVisible();
  });

  test('docs page loads', async ({ page }) => {
    await page.getByRole('link', { name: 'Docs' }).first().click();
    await expect(page).toHaveURL(/.*docs\/intro/);
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  });

  test('api page loads', async ({ page }) => {
    await page.getByRole('link', { name: 'API' }).first().click();
    await expect(page).toHaveURL(/.*docs\/api\/class-playwright/);
  });
});
