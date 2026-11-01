import { useEffect, useRef, useState } from "react";

import { DURATION, prefersReducedMotion } from "../motion";

export type MaybeLeaving<T> = T & { __leaving?: boolean };

/**
 * Keeps records that were removed from `all` (e.g. deleted) visible for a
 * moment, flagged `__leaving`, so they can animate out instead of vanishing.
 * Records merely filtered out of `visible` disappear immediately.
 */
export function useExitingRecords<T extends object>(visible: T[], all: T[], getId: (record: T) => string): MaybeLeaving<T>[] {
    const previousVisible = useRef<T[]>(visible);
    const previousAllIds = useRef<Set<string>>(new Set(all.map(getId)));
    const [leaving, setLeaving] = useState<Map<string, { record: T; index: number }>>(new Map());
    // Removal timers live outside the effect: new data arriving mid-animation
    // must not cancel them, or the ghost row would never be removed.
    const timers = useRef<number[]>([]);

    useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

    useEffect(() => {
        const allIds = new Set(all.map(getId));
        const removed = new Map<string, { record: T; index: number }>();
        if (!prefersReducedMotion()) {
            previousVisible.current.forEach((record, index) => {
                const id = getId(record);
                if (previousAllIds.current.has(id) && !allIds.has(id)) removed.set(id, { record, index });
            });
        }
        previousVisible.current = visible;
        previousAllIds.current = allIds;
        if (removed.size === 0) return;

        setLeaving(current => new Map([...current, ...removed]));
        timers.current.push(window.setTimeout(() => {
            setLeaving(current => {
                const next = new Map(current);
                removed.forEach((_, id) => next.delete(id));
                return next;
            });
        }, DURATION.slow * 1000 + 50));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, all]);

    if (leaving.size === 0) return visible;
    const merged: MaybeLeaving<T>[] = [...visible];
    [...leaving.values()]
        .sort((a, b) => a.index - b.index)
        .forEach(({ record, index }) => merged.splice(Math.min(index, merged.length), 0, { ...record, __leaving: true }));
    return merged;
}
