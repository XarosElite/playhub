import { expect, test } from './fixtures';

test.describe('signing in', () => {
  test('signed-out visitors land on the login page', async ({ page }) => {
    await page.goto('/server/survival-world');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('Google sign-in opens the dashboard, then returns to where you were headed', async ({ page, backend }) => {
    await page.goto('/server/survival-world');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page).toHaveURL(/\/server\/survival-world$/);
    await expect(page.getByRole('heading', { name: 'survival-world' })).toBeVisible();
    // The backend was asked to confirm the account, with the ID token.
    expect(backend.requests.find(r => r.path === '/auth/me')?.auth).toBe('Bearer e2e-token-uid-me');
  });

  test('closing the Google popup is not an error', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => { (window as unknown as { __e2eGoogleAccount: string }).__e2eGoogleAccount = 'closed'; });
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the session survives a reload', async ({ signedInPage: page }) => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
  });

  test('signing out returns to the login page', async ({ signedInPage: page }) => {
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByText('jacob@example.com')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('every API request carries the ID token', async ({ signedInPage: page, backend }) => {
    await expect(page.getByText('survival-world', { exact: true })).toBeVisible();
    expect(backend.requests.length).toBeGreaterThan(0);
    for (const request of backend.requests) expect(request.auth).toBe('Bearer e2e-token-uid-me');
  });
});
