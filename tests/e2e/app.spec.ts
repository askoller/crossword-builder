import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

async function loadFixtures(page: Page) {
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Load fixtures (dev)' }).click();
  await expect(page.getByText('test fixtures')).toBeVisible({ timeout: 30_000 });
}

/** Tap a grid cell by row/column. */
async function tapCell(page: Page, row: number, col: number, size = 15) {
  const box = (await page.locator('svg.grid').boundingBox())!;
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / size, box.y + ((row + 0.5) * box.height) / size);
}

test('home and editor screenshots', async ({ page }) => {
  await loadFixtures(page);
  await page.getByRole('button', { name: 'Puzzles' }).click();
  await expect(page.getByText('Fixture themed 15')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'home');

  await page.getByText('Fixture themed 15').click();
  await expect(page.locator('svg.grid')).toBeVisible();
  await tapCell(page, 0, 0);
  await page.getByRole('button', { name: 'S', exact: true }).click();
  await page.getByRole('button', { name: 'C', exact: true }).click();
  await page.getByRole('button', { name: 'A', exact: true }).click();
  await page.getByRole('button', { name: 'B', exact: true }).click();
  await tapCell(page, 0, 0);
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'editor');

  await page.getByRole('button', { name: 'Fill' }).or(page.getByRole('tab', { name: 'Fill' })).first().click();
  await shot(page, 'editor-panel');
});

test('new puzzle: type, blocks with symmetry, undo and redo across reload', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('E2E grid');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.head-title .title')).toHaveText('E2E grid');

  // physical keyboard typing; a new puzzle starts at 1-Across
  await expect(page.locator('.cluebar .cluebar-label')).toHaveText('1-Across');
  await page.keyboard.type('crab');
  await expect(page.locator('.cluebar .pattern')).toHaveText('CRAB' + '?'.repeat(11));

  // block with rotational symmetry
  await tapCell(page, 0, 5);
  await page.keyboard.press('.');
  await expect(page.locator('.cluebar .cluebar-clue')).toHaveText('Block');
  const blocks = () => page.locator('svg.grid rect[fill="var(--ink)"], svg.grid rect[fill="#3A3F4B"]').count();
  expect(await blocks()).toBe(2);

  // undo the block, reload, redo it
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await blocks()).toBe(0);
  await page.waitForTimeout(600); // autosave debounce
  await page.reload();
  await expect(page.locator('svg.grid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await blocks()).toBe(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  // undo puts the cursor back where the step happened (the B)
  await expect(page.locator('.cluebar .cluebar-label')).toHaveText('1-Across');
  await expect(page.locator('.cluebar .pattern')).toHaveText('CRA' + '?'.repeat(12));

  // Space switches direction; the on-screen keyboard types
  await page.keyboard.press(' ');
  await expect(page.locator('.cluebar .cluebar-label')).toHaveText('4-Down');
  await page.getByRole('button', { name: 'Q', exact: true }).click();
  await expect(page.locator('.cluebar .pattern')).toHaveText('Q' + '?'.repeat(14));

  // typing moved the cursor to row 2; tapping the selected cell switches direction
  await tapCell(page, 1, 3);
  await expect(page.locator('.cluebar .cluebar-label')).toHaveText('16-Across');
});
