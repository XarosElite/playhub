import type { Transition, Variants } from "motion/react";

/**
 * Shared motion tokens so every animation in the app feels like part of the
 * same system. Keep UI feedback fast (≤250ms); reserve longer durations for
 * page-level transitions.
 */
export const DURATION = {
    fast: 0.15,
    base: 0.22,
    slow: 0.35,
} as const;

// Same curves in CSS (index.css) and for Web Animations (`element.animate`).
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_OUT_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

export const transition: Transition = { duration: DURATION.base, ease: EASE_OUT };

export const spring: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 };

/** Fade and rise into place. */
export const fadeUp: Variants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition },
};

/** Parent that staggers its children's `fadeUp`. */
export const stagger = (step = 0.06, delay = 0): Variants => ({
    hidden: {},
    visible: { transition: { staggerChildren: step, delayChildren: delay } },
});

/** Page cross-fade used by the router. */
export const page: Variants = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
    exit: { opacity: 0, y: -4, transition: { duration: DURATION.fast, ease: "easeIn" } },
};

export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
