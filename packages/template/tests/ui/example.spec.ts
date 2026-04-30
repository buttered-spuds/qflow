import { test, expect } from '@playwright/test';

// Example UI smoke test — replace with your own.
// Tag tests with @smoke to include them in: npx qflow run --suite smoke

test('homepage loads @smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
});

test('navigation is present', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await expect(nav).toBeVisible();
});
