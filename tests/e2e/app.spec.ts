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
  // the grid sizes itself after layout; wait until its box stops changing
  const grid = page.locator('svg.grid');
  let box = (await grid.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const next = (await grid.boundingBox())!;
    if (next.width > 0 && next.width === box.width && next.x === box.x && next.y === box.y) break;
    box = next;
  }
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

  await page.getByRole('button', { name: 'Fill', exact: true }).or(page.getByRole('tab', { name: 'Fill' })).first().click();
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

test('notebook, clue browser, clue editor and theme panel', async ({ page }) => {
  await loadFixtures(page);

  await page.getByRole('button', { name: 'Notebook' }).click();
  await expect(page.getByText('TEA PARTY')).toBeVisible();
  await expect(page.getByText('8 letters · 2 words (3, 5)')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'notebook-answers');
  await page.getByText('TEA PARTY').click();
  await expect(page.getByRole('dialog', { name: 'Edit answer' })).toBeVisible();
  await shot(page, 'notebook-answer-edit');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('tab', { name: /Themes/ }).click();
  await expect(page.getByText('Fixture theme', { exact: true })).toBeVisible();
  await shot(page, 'notebook-themes');

  await page.getByRole('button', { name: 'Clues' }).click();
  await page.getByRole('textbox', { name: 'Answer' }).fill('er');
  await page.locator('.list-row', { hasText: /^ERA/ }).click();
  await expect(page.locator('.history-list li').first()).toBeVisible();
  await shot(page, 'clues');

  // Clue editor on a typed entry, with the near-duplicate warning
  await page.getByRole('button', { name: 'Puzzles' }).click();
  await page.getByText('Fixture open 15').click();
  await tapCell(page, 3, 0);
  await expect(page.locator('.cluebar .cluebar-label')).toHaveText(/Across/);
  await page.keyboard.type('era');
  await page.getByRole('button', { name: 'Clue', exact: true }).or(page.getByRole('tab', { name: 'Clues' })).first().click();
  await page.getByRole('textbox', { name: 'Your clue' }).fill('History fixture clue');
  await expect(page.locator('.inline-warning')).toContainText('Close to');
  await shot(page, 'clue-editor');
  await page.getByRole('button', { name: 'Save clue' }).click();
  await expect(page.getByRole('button', { name: 'Save clue' })).toBeDisabled();
  if (await page.locator('.clue-screen').count()) await page.locator('.clue-screen').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.cluebar .cluebar-clue')).toHaveText('History fixture clue');

  // Start a puzzle from the theme and open its Theme entries
  await page.getByRole('button', { name: 'Back to puzzles' }).click();
  await page.getByRole('button', { name: 'Notebook' }).click();
  await page.getByRole('tab', { name: /Themes/ }).click();
  await page.getByRole('button', { name: 'Start a puzzle' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.head-title .title')).toHaveText('Fixture theme');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Theme entries/ }).click();
  await expect(page.getByText('SPOUSE', { exact: true })).toBeVisible();
  await shot(page, 'editor-theme');
});
