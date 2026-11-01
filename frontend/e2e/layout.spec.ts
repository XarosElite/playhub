import { expect, startSignedIn, test } from './fixtures';
import { server } from './fakeBackend';

const noHorizontalScroll = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

test.describe('layout', () => {
  test.use({
    seed: { servers: [
      server('a-server-with-a-really-long-name-36', { Ports: { primary_port: 10000 }, SharedWith: [] }),
      server('second', { State: 'failed', StatusMessage: 'Failed to start: port is already allocated', Ports: { primary_port: 10001 } }),
    ] },
  });

  test('the dashboard fits the screen', async ({ signedInPage: page }) => {
    await expect(page.locator('tr[data-row-id]')).toHaveCount(2);
    await noHorizontalScroll(page);
  });

  test('the server page fits the screen', async ({ signedInPage: page }) => {
    await page.goto('/server/second');
    await expect(page.getByText('Failed to start: port is already allocated')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('the login page fits the screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('works with reduced motion', async ({ page, backend }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startSignedIn(page);
    await page.goto('/');
    await expect(page.locator('tr[data-row-id]')).toHaveCount(2);
    backend.servers = backend.servers.slice(1);
    backend.broadcast();
    await expect(page.locator('tr[data-row-id]')).toHaveCount(1);
  });

  test('light mode', async ({ signedInPage: page }) => {
    // On phones the toggle lives in the navigation drawer.
    const burger = page.locator('.mantine-Burger-root:visible');
    if (page.viewportSize()!.width < 768) await burger.click();
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  });
});
