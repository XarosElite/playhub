/**
 * Browser APIs jsdom lacks that Mantine, mantine-datatable, motion and xterm
 * rely on. Imported once by setup.ts.
 */
import { vi } from 'vitest';

// --- matchMedia (Mantine color scheme, useMediaQuery, DataTable columns, prefers-reduced-motion) ---
let reducedMotion = false;
let viewportWidth = 1440;

/** Simulate the OS "reduce motion" setting. */
export function setReducedMotion(value: boolean) {
  reducedMotion = value;
}

/** Simulate the window width media queries are evaluated against (default 1440px). */
export function setViewportWidth(width: number) {
  viewportWidth = width;
}

const toPx = (value: string, unit: string) => parseFloat(value) * (unit === 'px' ? 1 : 16);

function evaluate(query: string): boolean {
  if (query.includes('prefers-reduced-motion')) return reducedMotion && query.includes('reduce');
  if (query.includes('prefers-color-scheme')) return query.includes('dark');
  const conditions = [...query.matchAll(/\((min|max)-width:\s*([\d.]+)(px|em|rem)\)/g)];
  if (conditions.length === 0) return true; // e.g. DataTable checks always-visible columns with an empty query
  return conditions.every(([, kind, value, unit]) =>
    kind === 'min' ? viewportWidth >= toPx(value, unit) : viewportWidth <= toPx(value, unit));
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    get matches() { return evaluate(query); },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

class IntersectionObserverStub {
  root = null;
  rootMargin = '';
  thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
window.IntersectionObserver = window.IntersectionObserver ?? (IntersectionObserverStub as unknown as typeof IntersectionObserver);

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? function () {};
Element.prototype.scrollTo = Element.prototype.scrollTo ?? function () {};
window.scrollTo = () => {};

// Web Animations API (row FLIP animations, confetti). Defined on HTMLElement,
// not Element: motion uses WAAPI whenever Element.prototype.animate exists,
// and a stub can't drive real animations to completion.
HTMLElement.prototype.animate = function () {
  return { finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {} } as unknown as Animation;
};

if (!globalThis.CSS?.escape) {
  (globalThis as { CSS: unknown }).CSS = { ...(globalThis.CSS ?? {}), escape: (value: string) => value.replace(/["\\]/g, '\\$&') };
}

// Mantine's ScrollArea and charts measure elements.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1024; } });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 768; } });

// getComputedStyle with pseudo-elements isn't implemented in jsdom.
const getComputedStyle = window.getComputedStyle;
window.getComputedStyle = (element: Element) => getComputedStyle(element);

// No canvas in jsdom (charts probe for it); report "unsupported" quietly.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
