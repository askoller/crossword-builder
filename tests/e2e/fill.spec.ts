import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

async function openFixture(page: Page, title: string) {
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Load fixtures (dev)' }).click();
  await expect(page.getByText('test fixtures')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Puzzles' }).click();
  await page.getByText(title).click();
  await expect(page.locator('svg.grid')).toBeVisible();
}

async function cellPoint(page: Page, row: number, col: number, size = 15): Promise<[number, number]> {
  const box = (await page.locator('svg.grid').boundingBox())!;
  return [box.x + ((col + 0.5) * box.width) / size, box.y + ((row + 0.5) * box.height) / size];
}

const letters = (page: Page) => page.locator('svg.grid text.cell-letter').count();
const isWide = () => test.info().project.name.startsWith('inner');

test('fill suggestions: preview and use a word', async ({ page }) => {
  await openFixture(page, 'Fixture open 15');
  await page.mouse.click(...(await cellPoint(page, 0, 0)));
  if (!isWide()) await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const rows = page.locator('.fill-row[role="option"]');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.fill-head')).toContainText('4 letters');
  await rows.nth(1).click();
  const word = (await rows.nth(1).locator('.fill-word').innerText()).replace(/\+\d+$/, '').trim();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'fill');
  await page.getByRole('button', { name: `Use ${word}` }).click();
  await expect(page.locator('.cluebar .pattern')).toHaveText(word);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cluebar .pattern')).toHaveText('????');
});

test('select mode: autofill the selection in place, keep as one undoable step', async ({ page }) => {
  await openFixture(page, 'Fixture open 15');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  // drag a rectangle over rows 0–1, columns 0–3 (1-Across and 14-Across)
  await page.mouse.move(...(await cellPoint(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await cellPoint(page, 1, 3)), { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.select-banner')).toContainText('8 squares selected');
  await shot(page, 'select');
  await page.getByRole('button', { name: 'Autofill these' }).click();
  await expect(page.locator('.select-banner')).toContainText(/Fill A of \d/, { timeout: 20_000 });
  expect(await letters(page)).toBe(8); // previewed letters
  await shot(page, 'select-results');
  await page.getByRole('button', { name: 'Keep' }).click();
  await expect(page.locator('.select-banner')).toHaveCount(0);
  expect(await letters(page)).toBe(8);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await letters(page)).toBe(0);
});

test('autofill screen fills the mini grid; check reports on it', async ({ page }) => {
  await openFixture(page, 'Fixture mini');
  await page.getByRole('button', { name: 'Autofill', exact: true }).click();
  await page.getByRole('button', { name: 'Fill the grid' }).click();
  await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Apply Fill A/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'autofill');
  await page.getByRole('button', { name: /Apply Fill A/ }).click();
  expect(await letters(page)).toBe(23);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('.check-panel')).toContainText('23/23');
  await expect(page.locator('.check-panel h2')).not.toContainText('checking');
  await shot(page, 'check');
});
