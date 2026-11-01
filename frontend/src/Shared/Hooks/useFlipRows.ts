import { RefObject, useLayoutEffect, useRef } from "react";

import { DURATION, EASE_OUT_CSS, prefersReducedMotion } from "../motion";

/**
 * Animates table rows (`tr[data-row-id]`) when the set or order of rows
 * changes: rows that move glide to their new position (FLIP) and new rows fade
 * in. Rows are left to the table to render, so this works with any table.
 */
export function useFlipRows(containerRef: RefObject<HTMLElement>, rowIds: string[]) {
    const positions = useRef<Map<string, number> | null>(null);
    const key = rowIds.join("|");

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const rows = container.querySelectorAll<HTMLElement>("tr[data-row-id]");
        const previous = positions.current;
        const next = new Map<string, number>();
        const animate = previous !== null && !prefersReducedMotion();

        rows.forEach(row => {
            const id = row.dataset.rowId!;
            // offsetTop is relative to the table, so scrolling doesn't count as movement.
            const top = row.offsetTop;
            next.set(id, top);
            if (!animate) return;

            const before = previous!.get(id);
            if (before === undefined) {
                row.animate(
                    [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
                    { duration: DURATION.slow * 1000, easing: EASE_OUT_CSS },
                );
            } else if (before !== top) {
                row.animate(
                    [{ transform: `translateY(${before - top}px)` }, { transform: "none" }],
                    { duration: DURATION.slow * 1000, easing: EASE_OUT_CSS },
                );
            }
        });
        positions.current = next;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
}
