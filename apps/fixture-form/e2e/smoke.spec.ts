import { test, expect } from '@playwright/test';

test('loads deal form and reflects typed value in the model JSON', async ({ page }) => {
  await page.goto('/deal/1');
  await expect(page.getByRole('tab', { name: 'Deal' })).toBeVisible();
  await page.locator('input[formcontrolname="dealAmount"]').fill('1250000');
  await expect(page.locator('#model')).toContainText('"dealAmount":"1250000"');
});

test('issuerName search shows loading indicator for at least 1.4s then 2 options', async ({ page }) => {
  await page.goto('/deal/1');
  await page.locator('.fib-select__trigger').click();

  const start = Date.now();
  await page.locator('.fib-select__search').fill('Goldman');

  await expect(page.locator('.fib-select__loading')).toBeVisible();
  await expect(page.locator('.fib-select__loading')).toBeHidden({ timeout: 3000 });
  expect(Date.now() - start).toBeGreaterThanOrEqual(1400);

  await expect(page.locator('.fib-select__option')).toHaveCount(2);
});

test('feeType select is absent until "Add fees" is clicked', async ({ page }) => {
  await page.goto('/deal/1');
  await expect(page.locator('select[formcontrolname="feeType"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add fees' }).click();
  await expect(page.locator('select[formcontrolname="feeType"]')).toHaveCount(1);
});
