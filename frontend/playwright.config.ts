import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;

/**
 * Browser tests: the real app (Vite dev server) against a fake PlayHub API
 * (e2e/fakeBackend.ts) with Firebase swapped for a fake sign-in.
 *
 *   yarn test:e2e            (needs Playwright browsers: `npx playwright install`)
 *   docker compose -f docker-compose.test.yml run --rm frontend-e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // A production build (with the fake sign-in): what users get, and no dev-server
  // dependency discovery reloading pages mid-test.
  webServer: {
    command: `PLAYHUB_E2E=1 node_modules/.bin/vite build --outDir dist-e2e --emptyOutDir --logLevel warn && node_modules/.bin/vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
