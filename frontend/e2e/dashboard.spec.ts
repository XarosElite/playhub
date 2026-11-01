import { chooseOption, expect, isMobile, row, startSignedIn, test } from './fixtures';

test.describe('dashboard', () => {
  test('lists servers live, with status, players and sharing', async ({ signedInPage: page, consoleErrors }) => {
    if (isMobile(page)) {
      // Phones show a coloured dot, labelled for screen readers.
      await expect(row(page, 'survival-world').getByLabel('Running')).toBeVisible();
      await expect(row(page, 'creative-build').getByLabel('Stopped')).toBeVisible();
    } else {
      await expect(row(page, 'survival-world')).toContainText('Running');
      await expect(row(page, 'creative-build')).toContainText('Stopped');
      await expect(row(page, 'survival-world')).toContainText('3 / 20');
      await expect(row(page, 'pals-with-sam')).toContainText('Shared');
    }
    expect(consoleErrors).toEqual([]);
  });

  test('status changes pushed by the API appear without reloading', async ({ signedInPage: page, backend }) => {
    backend.update('survival-world', { State: 'exited', Live: null, StatusMessage: 'Stopped unexpectedly (exit code 137)' });
    await expect(row(page, 'survival-world').getByLabel('Stop survival-world')).toHaveCount(0);
    await expect(row(page, 'survival-world').getByRole('button', { name: 'Start survival-world' })).toBeVisible();
  });

  test('stopping a server shows progress, then the result', async ({ signedInPage: page, backend }) => {
    await row(page, 'survival-world').getByRole('button', { name: 'Stop survival-world' }).click();
    await expect(row(page, 'survival-world').getByRole('button', { name: /survival-world/ }).first()).toBeDisabled();
    await expect(row(page, 'survival-world').getByRole('button', { name: 'Start survival-world' })).toBeEnabled();
    expect(backend.requests.some(r => r.method === 'POST' && r.path === '/servers/cid-survival-world' && (r.body as { Action: number }).Action === 2)).toBe(true);
  });

  test('creating a server: it appears straight away, then celebrates when it comes up', async ({ signedInPage: page, backend }) => {
    await page.getByRole('button', { name: 'Add Server' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Game' }).click();
    await chooseOption(page, 'MINECRAFT');
    await dialog.getByLabel(/Server Name/).fill('brand-new');
    await dialog.getByLabel('Max Players').fill('8');
    await dialog.getByRole('button', { name: 'Submit' }).click();

    await expect(dialog).toBeHidden();
    await expect(row(page, 'brand-new')).toBeVisible();
    await expect(page.getByText('🎉 brand-new is live!')).toBeVisible();
    const create = backend.requests.find(r => r.path === '/servers/create')!;
    expect(create.body).toEqual({ game_type: 'minecraft', name: 'brand-new', environment: { MAX_PLAYERS: 8, EULA: true, MODE: 'survival', SEED: '' } });
  });

  test('the create form checks the name before sending', async ({ signedInPage: page, backend }) => {
    await page.getByRole('button', { name: 'Add Server' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Game' }).click();
    await chooseOption(page, 'PALWORLD');
    await dialog.getByLabel(/Server Name/).fill('bad name!');
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await expect(dialog.getByText('Can only contain letters, numbers, ".", "_", or "-"')).toBeVisible();
    expect(backend.requests.some(r => r.path === '/servers/create')).toBe(false);
  });

  test('a taken name is reported', async ({ signedInPage: page }) => {
    await page.getByRole('button', { name: 'Add Server' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Game' }).click();
    await chooseOption(page, 'MINECRAFT');
    await dialog.getByLabel(/Server Name/).fill('survival-world');
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText("The name 'survival-world' is already taken")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('deleting asks for confirmation and the row animates away', async ({ signedInPage: page }) => {
    await row(page, 'creative-build').getByRole('button', { name: 'More actions for creative-build' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await expect(page.getByText('Delete creative-build?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete server' }).click();
    await expect(page.getByText('Server deleted.')).toBeVisible();
    await expect(row(page, 'creative-build')).toHaveCount(0);
  });

  test('servers shared with you cannot be deleted', async ({ signedInPage: page }) => {
    await row(page, 'pals-with-sam').getByRole('button', { name: 'More actions for pals-with-sam' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open server page' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete…' })).toHaveCount(0);
  });

  test('search and filters', async ({ signedInPage: page }) => {
    const search = page.getByPlaceholder('Search servers');
    await search.fill('creative');
    await expect(page.locator('tr[data-row-id]')).toHaveCount(1);
    await search.fill('nothing-like-this');
    await expect(page.getByText('No servers match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.locator('tr[data-row-id]')).toHaveCount(3);
    await page.getByText('Shared with me').click();
    await expect(page.locator('tr[data-row-id]')).toHaveCount(1);
    await expect(row(page, 'pals-with-sam')).toBeVisible();
  });

  test('keyboard: / to search, arrows to move, O to open', async ({ signedInPage: page }) => {
    test.skip(isMobile(page), 'no keyboard on phones');
    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Search servers')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('o');
    await expect(page).toHaveURL(/\/server\/creative-build$/);
  });

  test('bulk actions', async ({ signedInPage: page, backend }) => {
    test.skip(isMobile(page), 'selection is a desktop feature');
    await row(page, 'survival-world').getByRole('checkbox').check();
    await row(page, 'creative-build').getByRole('checkbox').check();
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText('1 server started.')).toBeVisible();
    expect(backend.requests.filter(r => r.method === 'POST' && r.path.startsWith('/servers/cid-')).map(r => r.path)).toEqual(['/servers/cid-creative-build']);
  });

  test('system information collapses and stays collapsed', async ({ signedInPage: page }) => {
    const toggle = page.getByRole('button', { name: /System Information/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(page.getByRole('button', { name: /System Information/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('falls back to polling when the live socket is unavailable', async ({ page, backend }) => {
    await page.routeWebSocket(/\/api\/servers\/live$/, ws => ws.close({ code: 1011 }));
    await startSignedIn(page);
    await page.goto('/');
    await expect(row(page, 'survival-world')).toBeVisible();
    expect(backend.requests.some(r => r.method === 'GET' && r.path === '/servers/')).toBe(true);
  });
});
