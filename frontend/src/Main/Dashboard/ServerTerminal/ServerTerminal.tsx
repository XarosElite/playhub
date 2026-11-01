import React, { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Group, Text, Tooltip } from "@mantine/core";
import { IconMaximize, IconMinimize, IconTrash, IconTerminal } from "@tabler/icons-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { getIdToken } from "../../../Auth/firebase";

import "@xterm/xterm/css/xterm.css";
import classes from "./ServerTerminal.module.scss";

interface ServerTerminalProps {
  serverId: string;
  serverName: string;
}

const ServerTerminal: React.FC<ServerTerminalProps> = ({ serverId, serverName }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;
    // Created on the next tick: xterm crashes if disposed before its first
    // render pass, which React's StrictMode remount would otherwise trigger.
    let teardown = () => {};
    const timer = window.setTimeout(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#141517",
        foreground: "#c1c2c5",
        cursor: "#5c5f66",
        selectionBackground: "#3b4048"
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln(`\x1b[33mConnecting to interactive terminal for ${serverName}...\x1b[0m`);

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/servers/${encodeURIComponent(serverId)}/terminal`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    // Keystrokes are only forwarded once the auth token has been sent.
    let authenticated = false;

    ws.onopen = async () => {
      // Browsers can't set headers on websockets, so the API expects the
      // Firebase ID token as the first message.
      const token = await getIdToken();
      if (!token || ws.readyState !== WebSocket.OPEN) {
        ws.close();
        return;
      }
      ws.send(token);
      authenticated = true;
      setConnected(true);
      term.writeln("\x1b[32mConnected to container session. Spawning interactive shell...\x1b[0m\r\n");
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[WebSocket Connection Error]\x1b[0m");
      setConnected(false);
    };

    ws.onclose = (event) => {
      if (event.code === 4401) {
        term.writeln("\r\n\x1b[31m[Not authorized – sign in again]\x1b[0m");
      }
      term.writeln("\r\n\x1b[33m[Terminal session closed]\x1b[0m");
      setConnected(false);
    };

    const dataListener = term.onData((data) => {
      if (authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit resize edge errors
      }
    };

    window.addEventListener("resize", handleResize);

    teardown = () => {
      dataListener.dispose();
      window.removeEventListener("resize", handleResize);
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
    };
    }, 0);
    return () => {
      window.clearTimeout(timer);
      teardown();
    };
  }, [serverId, serverName]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit();
    }, 150);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  const clearTerminal = () => {
    xtermRef.current?.clear();
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  return (
    <div className={`${classes.terminalWrapper} ${isFullscreen ? classes.fullscreen : ""}`}>
      <div className={classes.terminalHeader}>
        <Group gap="xs">
          <IconTerminal size={18} />
          <Text size="sm" fw={600}>
            {serverName} Terminal
          </Text>
          <Badge size="xs" color={connected ? "green" : "red"}>
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </Group>
        <Group gap="xs">
          <Tooltip label="Clear terminal">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={clearTerminal}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div ref={terminalRef} className={classes.terminalContainer} />

      <Tooltip label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
        <ActionIcon
          className={classes.fullscreenBtn}
          size="md"
          variant="filled"
          color="dark"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
        </ActionIcon>
      </Tooltip>
    </div>
  );
};

export default ServerTerminal;
