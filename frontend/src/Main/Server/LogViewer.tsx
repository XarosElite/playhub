import React, { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Group, Switch, Text, Tooltip } from "@mantine/core";
import { IconArrowDown, IconRefresh, IconTrash } from "@tabler/icons-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { openAuthedSocket, WS_UNAUTHORIZED } from "../../Api/Socket";

import "@xterm/xterm/css/xterm.css";
import classes from "./ServerPage.module.scss";

/** Live, read-only view of a server's console output (`docker logs -f`). */
const LogViewer: React.FC<{ serverId: string; running: boolean }> = ({ serverId, running }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const [connected, setConnected] = useState(false);
    const [follow, setFollow] = useState(true);
    const followRef = useRef(follow);
    followRef.current = follow;
    // Bumped to reconnect, e.g. after the server starts again.
    const [session, setSession] = useState(0);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        // Created on the next tick: xterm crashes if disposed before its first
        // render pass, which React's StrictMode remount (and quick tab
        // switches) would otherwise trigger.
        let teardown = () => {};
        const timer = window.setTimeout(() => {
        const term = new Terminal({
            convertEol: true,
            disableStdin: true,
            cursorStyle: 'underline',
            cursorInactiveStyle: 'none',
            scrollback: 5000,
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: 13,
            theme: { background: "#141517", foreground: "#c1c2c5", selectionBackground: "#3b4048" },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);
        fit.fit();
        termRef.current = term;

        let disposed = false;
        const ws = openAuthedSocket(`/servers/${encodeURIComponent(serverId)}/logs`, () => setConnected(true));
        ws.onmessage = event => {
            if (disposed) return;
            term.write(event.data);
            if (followRef.current) term.scrollToBottom();
        };
        ws.onclose = event => {
            setConnected(false);
            if (event.code === WS_UNAUTHORIZED) term.writeln("\r\n\x1b[31m[Not authorized – sign in again]\x1b[0m");
        };

        const resize = () => { try { fit.fit(); } catch { /* not visible */ } };
        window.addEventListener("resize", resize);
        teardown = () => {
            disposed = true;
            window.removeEventListener("resize", resize);
            ws.onmessage = null;
            ws.close();
            termRef.current = null;
            term.dispose();
        };
        }, 0);
        return () => {
            window.clearTimeout(timer);
            teardown();
        };
    }, [serverId, session]);

    // Reconnect when the server comes back up so new output streams in.
    const wasRunning = useRef(running);
    useEffect(() => {
        if (running && !wasRunning.current) setSession(s => s + 1);
        wasRunning.current = running;
    }, [running]);

    return (
        <div className={classes.console}>
            <Group className={classes.consoleHeader} justify="space-between">
                <Group gap="xs">
                    <Text size="sm" fw={600}>Console output</Text>
                    <Badge size="xs" color={connected ? 'green' : 'gray'} variant={connected ? 'filled' : 'light'}>
                        {connected ? 'Live' : 'Not streaming'}
                    </Badge>
                </Group>
                <Group gap="xs">
                    <Switch size="xs" label="Follow" checked={follow} onChange={e => setFollow(e.currentTarget.checked)} />
                    <Tooltip label="Jump to latest">
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => termRef.current?.scrollToBottom()} aria-label="Jump to latest">
                            <IconArrowDown size={16} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Reload">
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setSession(s => s + 1)} aria-label="Reload logs">
                            <IconRefresh size={16} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Clear">
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => termRef.current?.clear()} aria-label="Clear console">
                            <IconTrash size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>
            <div ref={containerRef} className={classes.consoleBody} />
        </div>
    );
};

export default LogViewer;
