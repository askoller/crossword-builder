import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png` });

async function loadFixtures(page: Page) {
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Load fixtures (dev)' }).click();
  await expect(page.getByText('test fixtures')).toBeVisible({ timeout: 30_000 });
}

async function openThemed(page: Page) {
  await loadFixtures(page);
  await page.getByRole('button', { name: 'Puzzles' }).click();
  await page.getByText('Fixture themed 15').click();
  await expect(page.locator('svg.grid')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

/** The element's box lies fully inside the viewport. */
async function expectOnScreen(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
}

const expectedLayout: Record<string, string> = {
  'cover-476x752': 'cover',
  'inner-1164x878': 'inner-landscape',
  'portrait-880x1164': 'inner-portrait',
  'phone-412x915': 'phone',
};

test('construct mode: layout from the viewport, keyboard always fits', async ({ page }) => {
  await openThemed(page);
  const name = test.info().project.name;
  await expect(page.locator('.editor')).toHaveAttribute('data-layout', expectedLayout[name]);
  await expect(page.getByRole('radio', { name: 'Construct' })).toHaveAttribute('aria-checked', 'true');
  await expectOnScreen(page, '.keyboard');
  await expectOnScreen(page, '.toolrow');
  // grid entry never opens the system keyboard: no focused text field
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  await shot(page, 'mode-construct');

  if (name === 'portrait-880x1164') {
    // panels open as a bottom sheet over the keyboard area; the grid stays full width
    await page.getByRole('button', { name: 'Fill', exact: true }).click();
    await expect(page.locator('.portrait-sheet')).toBeVisible();
    await expectOnScreen(page, '.portrait-sheet');
    await page.getByRole('tab', { name: 'Theme' }).click();
    await expect(page.getByRole('tab', { name: 'Theme' })).toHaveAttribute('aria-selected', 'true');
    await shot(page, 'portrait-sheet');
    // rotate to landscape and back: the open panel survives
    await page.setViewportSize({ width: 1164, height: 880 });
    await expect(page.locator('.editor')).toHaveAttribute('data-layout', 'inner-landscape');
    await expect(page.getByRole('tab', { name: 'Theme' })).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 880, height: 1164 });
    await expect(page.locator('.editor')).toHaveAttribute('data-layout', 'inner-portrait');
    await expect(page.locator('.portrait-sheet')).toBeVisible();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expectOnScreen(page, '.keyboard');
  }
});

test('clue mode: list, pinned editor, Next saves, keyboard simulation, history', async ({ page }) => {
  await openThemed(page);
  const name = test.info().project.name;
  const vp = page.viewportSize()!;
  await page.getByRole('radio', { name: 'Clue' }).click();
  await expect(page.locator('.clue-mode')).toBeVisible();
  await expect(page.locator('.cl-head').first()).toHaveText('Across');
  await expect(page.locator('.cl-row.empty').first()).toBeVisible();
  await expect(page.locator('.clue-mode svg.grid')).toBeVisible(); // keyboard closed: grid shown
  await shot(page, 'mode-clue');

  // type a clue; Enter saves and moves on, keeping focus in the field
  const field = page.locator('#clue-compose');
  await field.click();
  const first = (await page.locator('.cl-row.on .cl-num').textContent())!;
  await field.fill('Test clue from e2e');
  await field.press('Enter');
  await expect(field).toBeFocused();
  await expect(page.locator('.cl-row', { hasText: 'Test clue from e2e' })).toHaveCount(1);
  await expect(page.locator('.cl-row.on .cl-num')).not.toHaveText(first);

  // simulated Android keyboard: the viewport loses 45 % of its height
  await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
  await expect(page.locator('.clue-mode.kb-open')).toBeVisible();
  await expect(page.locator('.editor')).toHaveAttribute('data-layout', expectedLayout[name]);
  if (name !== 'inner-1164x878') await expect(page.locator('.clue-mode svg.grid')).toHaveCount(0);
  else await expect(page.locator('.clue-mode svg.grid')).toBeVisible();
  // the editor is pinned to the bottom, directly above the keyboard
  const comp = (await page.locator('.clue-composer').boundingBox())!;
  expect(Math.abs(comp.y + comp.height - Math.round(vp.height * 0.55))).toBeLessThanOrEqual(2);
  await expectOnScreen(page, '.cl-row.on');
  await field.type('Second');
  await expect(field).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'mode-clue-keyboard');

  // History opens over the list; the clue field keeps focus (keyboard stays open)
  await page.getByRole('button', { name: 'Next clue' }).click();
  await expect(field).toBeFocused();
  // 17-Across is a filled theme entry, so its history is available
  await page.locator('.cl-row').filter({ has: page.locator('.cl-num', { hasText: /^17$/ }) }).first().click();
  await expect(field).toBeFocused();
  await expect(page.locator('.cs-label')).toHaveText('17-Across');
  const hist = page.getByRole('button', { name: /^History/ });
  {
    await hist.click();
    await expect(page.getByRole('dialog', { name: 'Clue history' })).toBeVisible();
    await expect(field).toBeFocused();
    await shot(page, 'mode-clue-history');
    await page.getByRole('button', { name: 'Close history' }).click();
  }

  // Done closes the keyboard and saves
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(field).not.toBeFocused();
  await page.setViewportSize(vp);
  await page.waitForTimeout(1200); // keyboard close grace
  await expect(page.locator('.clue-mode.kb-open')).toHaveCount(0);

  // tapping a cell jumps to its clue
  const box = (await page.locator('.clue-mode svg.grid').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5 / 15, box.y + box.height * 0.5 / 15);
  await expect(page.locator('.cl-row.on .cl-num')).toHaveText('1');

  // the mode is remembered for this puzzle
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('.clue-mode')).toBeVisible();
  await expect(page.locator('.cl-row', { hasText: 'Test clue from e2e' })).toHaveCount(1);
  await page.getByRole('radio', { name: 'Construct' }).click();
  await expect(page.locator('.keyboard')).toBeVisible();
});

test('rename field stays above the keyboard', async ({ page }) => {
  await openThemed(page);
  const vp = page.viewportSize()!;
  await page.locator('.head-title .title').click();
  const input = page.getByRole('textbox', { name: 'Title' });
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
  await page.waitForTimeout(150);
  await expectOnScreen(page, '.dialog');
  await expectOnScreen(page, '.dialog input');
});
