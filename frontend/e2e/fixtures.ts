import { test as base, expect, Page } from '@playwright/test';

import { FakePlayhub, FakeServer } from './fakeBackend';

export const SIGNED_IN = { uid: 'uid-me', email: 'jacob@example.com', displayName: 'Jacob Poling', photoURL: null };

type Fixtures = {
  backend: FakePlayhub;
  /** Servers the fake API starts with, e.g. test.use({ seed: { servers: [...] } }). */
  seed: { servers: FakeServer[] } | undefined;
  signedInPage: Page;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  seed: [undefined, { option: true }],
  backend: async ({ seed }, use) => {
    await use(new FakePlayhub(seed?.servers));
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await use(errors);
  },
  page: async ({ page, backend }, use) => {
    await backend.install(page);
    await use(page);
  },
  signedInPage: async ({ page }, use) => {
    await startSignedIn(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
    await use(page);
  },
});

export { expect };

/**
 * Starts the tab with a signed-in session. Init scripts run on every
 * navigation, so the session is only seeded once per tab (signing out sticks).
 */
export async function startSignedIn(page: Page) {
  await page.addInitScript(user => {
    if (sessionStorage.getItem('playhub-e2e-seeded')) return;
    sessionStorage.setItem('playhub-e2e-seeded', '1');
    localStorage.setItem('playhub-e2e-user', JSON.stringify(user));
  }, SIGNED_IN);
}

/** The row for a server in the dashboard table. */
export const row = (page: Page, name: string) => page.locator('tr[data-row-id]').filter({ has: page.getByText(name, { exact: true }) });

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/**
 * Picks an option from an open Select/MultiSelect dropdown. Uses a CSS locator:
 * inside a modal, Mantine 7.13's focus trap marks the dropdown aria-hidden
 * (fixed in Mantine 7.15), which hides it from role-based queries.
 */
export const chooseOption = (page: Page, name: string | RegExp) =>
  page.locator('[role="option"]').filter({ hasText: name }).click();
