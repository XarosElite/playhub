import React, { useEffect, useRef, useState } from "react";
import { animate } from "motion/react";

import { prefersReducedMotion } from "../../motion";

interface AnimatedNumberProps {
    value: number | null | undefined;
    decimals?: number;
    suffix?: string;
    fallback?: string;
}

/** A number that counts smoothly to each new value instead of jumping. */
const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, decimals = 0, suffix = '', fallback = '—' }) => {
    const [display, setDisplay] = useState<number | null>(value ?? null);
    const current = useRef<number | null>(value ?? null);

    useEffect(() => {
        if (value === null || value === undefined) {
            current.current = null;
            setDisplay(null);
            return;
        }
        const from = current.current;
        if (from === null || prefersReducedMotion()) {
            current.current = value;
            setDisplay(value);
            return;
        }
        const controls = animate(from, value, {
            duration: 0.6,
            ease: 'easeOut',
            onUpdate: latest => {
                current.current = latest;
                setDisplay(latest);
            },
        });
        return () => controls.stop();
    }, [value]);

    if (display === null) return <>{fallback}</>;
    return <>{display.toFixed(decimals)}{suffix}</>;
};

export default AnimatedNumber;
