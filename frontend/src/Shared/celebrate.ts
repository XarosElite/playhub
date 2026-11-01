import { prefersReducedMotion } from "./motion";

const COLORS = ["#40c057", "#69db7c", "#fcc419", "#4dabf7", "#f783ac", "#ffffff"];

/**
 * A small confetti burst centred on `element` (e.g. a server's status badge).
 * Pure DOM + Web Animations; cleans up after itself. Skipped when the user
 * prefers reduced motion.
 */
export function celebrateAt(element: Element | null, pieces = 26) {
    if (!element || prefersReducedMotion()) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;

    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "1000" });
    document.body.appendChild(layer);

    const animations = Array.from({ length: pieces }, (_, i) => {
        const piece = document.createElement("span");
        const size = 5 + Math.random() * 5;
        Object.assign(piece.style, {
            position: "absolute",
            left: `${originX}px`,
            top: `${originY}px`,
            width: `${size}px`,
            height: `${size * (Math.random() > 0.5 ? 1 : 0.45)}px`,
            background: COLORS[i % COLORS.length],
            borderRadius: Math.random() > 0.6 ? "50%" : "2px",
        });
        layer.appendChild(piece);

        const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.5;
        const distance = 40 + Math.random() * 70;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 30;
        return piece.animate(
            [
                { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1 },
                { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.6 },
                { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 60}px)) scale(0.6) rotate(${Math.random() * 720}deg)`, opacity: 0 },
            ],
            { duration: 900 + Math.random() * 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
        ).finished;
    });

    Promise.allSettled(animations).then(() => layer.remove());
}
