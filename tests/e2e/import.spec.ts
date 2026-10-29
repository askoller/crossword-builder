// Data pack import from Drive in one step, local files picked one at a time, and
// New puzzle → Import of a .puz.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { computeSlots } from '../../src/model/grid';
import { exportPuz } from '../../src/model/puz';
import type { Puzzle } from '../../src/model/types';
import { mockGoogle } from './mockGoogle';

const FIX = join(process.cwd(), 'fixtures');
const NAMES = ['manifest.json', 'words.tsv.gz', 'clues.json.gz', 'my-scores.json', 'notebook.json'];

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

test('Import from Google Drive reads every file in Crossword Builder/data', async ({ page }) => {
  const files = await mockGoogle(page);
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await page.getByRole('button', { name: 'Create new folder' }).click();
  await expect.poll(() => files.some((f) => f.name === 'puzzles')).toBe(true);
  const root = files.find((f) => f.name === 'Crossword Builder')!;
  // what the laptop put there
  files.push({ id: 'data1', name: 'data', mimeType: 'application/vnd.google-apps.folder', parents: [root.id], modifiedTime: new Date().toISOString(), body: Buffer.alloc(0) });
  NAMES.forEach((name, i) => files.push({ id: `pack${i}`, name, mimeType: 'application/octet-stream', parents: ['data1'], modifiedTime: new Date().toISOString(), body: readFileSync(join(FIX, name)) }));

  await page.getByRole('button', { name: 'Import data pack from Google Drive' }).click();
  await expect(page.getByText('Data pack imported.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('test fixtures')).toBeVisible();
  await expect(page.getByText(/clues for/)).not.toContainText(/^0 clues/);
  await shot(page, 'settings-drive-import');
});

test('local data pack files can be picked one at a time', async ({ page }) => {
  await page.goto('#/settings');
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles(join(FIX, 'manifest.json'));
  await input.setInputFiles(join(FIX, 'clues.json.gz'));
  const list = page.getByRole('list', { name: 'Files to import' });
  await expect(list.locator('li.on')).toHaveCount(2);
  await shot(page, 'settings-local-files');
  await page.getByRole('button', { name: 'Import 2 files' }).click();
  await expect(page.getByText('2 files imported.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('test fixtures')).toBeVisible();
});

test('New puzzle → Import a .puz with locked letters', async ({ page }) => {
  const p = JSON.parse(readFileSync(join(FIX, 'grids/fixture-themed-15x15.json'), 'utf8')) as Puzzle;
  for (const s of computeSlots(p.width, p.height, p.cells).slots) p.clues[s.id] = { text: `Imported clue ${s.id}` };
  p.title = 'From Across Lite';
  const bytes = Buffer.from(exportPuz(p, { author: 'Someone' }));

  await page.goto('#/');
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await page.getByRole('radio', { name: 'Import' }).click();
  await page.getByLabel('Crossword file').setInputFiles({ name: 'sample.puz', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('.import-preview')).toContainText('From Across Lite');
  await expect(page.locator('.import-preview')).toContainText('15×15');
  await expect(page.locator('.notice-inline')).toContainText('author “Someone”');
  await page.getByRole('radio', { name: 'Locked' }).click();
  await shot(page, 'new-puzzle-import');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('svg.grid')).toBeVisible();
  await expect(page.locator('.cluebar')).toContainText('Imported clue A1');
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'imported-puzzle');
});
