/**
 * Global test setup: jest-dom matchers, browser API stubs, and per-test cleanup.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { setReducedMotion, setViewportWidth } from './browser';

afterEach(async () => {
  cleanup();
  // Mantine keeps notifications and modals in global stores; clear them so
  // one test's toasts don't fill the queue for the next.
  const { notifications } = await import('@mantine/notifications');
  notifications.clean?.();
  notifications.cleanQueue?.();
  const { modals } = await import('@mantine/modals');
  modals.closeAll?.();
  localStorage.clear();
  setReducedMotion(false);
  setViewportWidth(1440);
});
