import { getIdToken } from "../Auth/firebase";

/** Close code the API uses when websocket authentication fails or the session expires. */
export const WS_UNAUTHORIZED = 4401;

/**
 * Opens a websocket to the API and authenticates it. Browsers can't set
 * headers on websockets, so the Firebase ID token is sent as the first
 * message. `onReady` runs once the token has been sent; only send other
 * messages after that.
 */
export function openAuthedSocket(path: string, onReady?: (ws: WebSocket) => void): WebSocket {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api${path}`);

    ws.addEventListener("open", async () => {
        const token = await getIdToken();
        if (!token || ws.readyState !== WebSocket.OPEN) {
            ws.close();
            return;
        }
        ws.send(token);
        onReady?.(ws);
    });

    return ws;
}
