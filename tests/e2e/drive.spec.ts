// Google Drive flows with Google mocked (see mockGoogle.ts). No real Google calls.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockGoogle } from './mockGoogle';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

test('connect Drive, choose folder, back up, export .puz', async ({ page }) => {
  const files = await mockGoogle(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Drive grid');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.keyboard.type('crab');

  // .puz export from the overflow menu
  await page.getByRole('button', { name: 'More' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Export \.puz/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^drive-grid-[0-9a-f]{8}\.puz$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(2, 13).toString('latin1')).toBe('ACROSS&DOWN');
  expect(bytes[0x2c]).toBe(15);

  await page.getByRole('button', { name: 'Back to puzzles' }).click();
  await expect(page.getByText('Not backed up yet')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'settings-drive-disconnected');

  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.getByRole('button', { name: 'Create new folder' })).toBeVisible();
  await shot(page, 'settings-drive-choose-folder');
  await page.getByRole('button', { name: 'Create new folder' }).click();
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
  await expect(page.getByText(/Last backup/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import data pack from Google Drive' })).toBeVisible();
  await shot(page, 'settings-drive-connected');

  expect(files.filter((f) => f.name === 'Crossword Builder')).toHaveLength(1);
  expect(files.some((f) => /^drive-grid-.*\.json$/.test(f.name))).toBe(true);
  expect(files.some((f) => /^drive-grid-.*\.puz$/.test(f.name))).toBe(true);
  expect(files.some((f) => f.name === 'notebook.json')).toBe(true);

  await page.getByRole('button', { name: 'Restore from Drive' }).click();
  await expect(page.getByRole('button', { name: 'Restore all 1' })).toBeVisible();
  await shot(page, 'settings-drive-restore');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Puzzles' }).click();
  await expect(page.getByText('Backed up to Google Drive')).toBeVisible();
  await shot(page, 'home-backed-up');
});
