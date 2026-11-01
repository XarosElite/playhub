import { expect, test } from './fixtures';

test.describe('server page', () => {
  test('opens from the dashboard and shows live stats', async ({ signedInPage: page, consoleErrors }) => {
    await page.getByText('survival-world', { exact: true }).dblclick();
    await expect(page).toHaveURL(/\/server\/survival-world$/);
    await expect(page.getByRole('heading', { name: 'survival-world' })).toBeVisible();
    await expect(page.getByText('203.0.113.7:10000')).toBeVisible();
    await expect(page.getByText('Version 1.21.4')).toBeVisible();
    await expect(page.getByText('CPU (last 2 minutes)')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('console streams the server log', async ({ signedInPage: page }) => {
    await page.goto('/server/survival-world?tab=console');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('Done (3.2s)!');
  });

  test('terminal connects and echoes input', async ({ signedInPage: page }) => {
    await page.goto('/server/survival-world?tab=terminal');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('/data #');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('whoami');
    await expect(page.locator('.xterm-rows')).toContainText('whoami');
  });

  test('changing settings asks first, then restarts the server with them', async ({ signedInPage: page, backend }) => {
    await page.goto('/server/survival-world?tab=settings');
    const save = page.getByRole('button', { name: 'Save settings' });
    await expect(save).toBeDisabled();
    await page.getByLabel('Max Players').fill('40');
    await save.click();
    await page.getByRole('button', { name: 'Apply and restart' }).click();
    await expect(page.getByText('Applying Max Players. The server restarts with the new settings.')).toBeVisible();
    await expect(page.getByText('Updating')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();
    expect(backend.find('survival-world')!.environment.MAX_PLAYERS).toBe(40);
  });

  test('sharing with someone', async ({ signedInPage: page, backend }) => {
    await page.goto('/server/survival-world?tab=sharing');
    await expect(page.getByText('Sam Rivera')).toBeVisible();
    await page.getByRole('textbox', { name: 'Shared with' }).click();
    await page.getByRole('option', { name: /Alex Chen/ }).click();
    await page.keyboard.press('Escape'); // close the dropdown, which covers the button
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('survival-world is shared with 2 people.')).toBeVisible();
    expect(backend.find('survival-world')!.SharedWith!.map(u => u.uid)).toEqual(['uid-sam', 'uid-alex']);
  });

  test('activity shows what happened, newest first', async ({ signedInPage: page }) => {
    await page.goto('/server/survival-world');
    await page.getByRole('button', { name: 'Restart' }).click();
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText('restarted the server')).toBeVisible();
    await expect(page.getByText('created the server')).toBeVisible();
  });

  test('servers shared with you have no sharing tab or delete', async ({ signedInPage: page }) => {
    await page.goto('/server/pals-with-sam');
    await expect(page.getByText('Shared by Sam Rivera')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sharing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0);
  });

  test('deleting returns to the dashboard', async ({ signedInPage: page }) => {
    await page.goto('/server/creative-build');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByRole('button', { name: 'Delete server' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('creative-build', { exact: true })).toHaveCount(0);
  });

  test('unknown servers', async ({ signedInPage: page }) => {
    await page.goto('/server/does-not-exist');
    await expect(page.getByText('Server not found')).toBeVisible();
  });
});
