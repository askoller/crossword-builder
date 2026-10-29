// The pieces sessions 2–4 built separately, working together: Notebook boosts in the Fill
// list, Notebook edits pushed to Drive, and New puzzle started from a Notebook theme.
import { expect, test, type Page } from '@playwright/test';
import { mockGoogle } from './mockGoogle';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

const isWide = () => test.info().project.name.startsWith('inner');

/** Open the Fill list for the top-left 4-letter slot of "Fixture open 15". */
async function openFill(page: Page) {
  // the grid sizes itself after layout; wait until its box stops changing
  const grid = page.locator('svg.grid');
  let box = (await grid.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const next = (await grid.boundingBox())!;
    if (next.width > 0 && next.width === box.width && next.x === box.x && next.y === box.y) break;
    box = next;
  }
  await page.mouse.click(box.x + box.width / 30, box.y + box.height / 30);
  await expect(page.locator('.cluebar .pattern')).toHaveText('????');
  if (!isWide()) await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const rows = page.locator('.fill-row[role="option"]');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  return rows;
}

test('notebook boosts reach Fill, notebook edits reach Drive, new puzzle from a theme', async ({ page }) => {
  const files = await mockGoogle(page);
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Load fixtures (dev)' }).click();
  await expect(page.getByText('test fixtures')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await page.getByRole('button', { name: 'Create new folder' }).click();
  await expect(page.getByText(/Last backup/)).toBeVisible();
  const notebookJson = () => files.find((f) => f.name === 'notebook.json')?.body.toString('utf8') ?? '';
  await expect.poll(notebookJson).toContain('TEA PARTY');

  // The engine has its word list loaded before the Notebook changes.
  await page.getByRole('button', { name: 'Puzzles' }).click();
  await page.getByText('Fixture open 15').click();
  let rows = await openFill(page);
  await expect(rows.first().locator('.fill-word')).not.toContainText('QXJZ');

  // A new boosted answer that isn't in the word list
  await page.getByRole('button', { name: 'Back to puzzles' }).click();
  await page.getByRole('button', { name: 'Notebook' }).click();
  await expect(page.getByText(/Synced with ThemeFill/)).toBeVisible();
  await page.getByRole('button', { name: 'New answer' }).click();
  await page.locator('#nb-answer').fill('QXJZ');
  await page.locator('#nb-boost').fill('100');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.nb-answer', { hasText: 'QXJZ' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'notebook-synced');

  // ...is written back to Drive's notebook.json (debounced push)
  await expect.poll(notebookJson, { timeout: 15_000 }).toContain('QXJZ');

  // ...and tops the Fill list with its boost shown.
  await page.getByRole('button', { name: 'Puzzles' }).click();
  await page.getByText('Fixture open 15').click();
  rows = await openFill(page);
  await expect(rows.first().locator('.fill-word')).toContainText('QXJZ');
  await expect(rows.first().locator('.boost')).toHaveText('+100');
  await shot(page, 'fill-boost');

  // New puzzle from Home, choosing the theme with the Notebook's theme cards
  await page.getByRole('button', { name: 'Back to puzzles' }).click();
  await page.getByRole('button', { name: 'New puzzle' }).click();
  const picker = page.getByRole('radiogroup', { name: 'Notebook theme' });
  await picker.getByRole('radio', { name: /Fixture theme/ }).click();
  await expect(picker.getByRole('radio', { name: /Fixture theme/ })).toHaveAttribute('aria-checked', 'true');
  await expect(picker.locator('.sym-pill').first()).toBeVisible();
  await picker.getByRole('radio', { name: /Fixture theme/ }).scrollIntoViewIfNeeded();
  await shot(page, 'new-puzzle-theme');
  await page.getByRole('button', { name: 'Create' }).click();

  // The editor opens on the theme's entries, ready to place them.
  await expect(page.locator('.head-title .title')).toHaveText('Fixture theme');
  await expect(page.getByText('SPOUSE', { exact: true })).toBeVisible();
  await shot(page, 'new-puzzle-theme-editor');
});
