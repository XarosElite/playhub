import React from "react";
import { ActionIcon, Group, Loader, Menu, Tooltip } from "@mantine/core";
import {
    IconDots, IconExternalLink, IconPlayerPlayFilled, IconPlayerStopFilled, IconRestore, IconShare, IconTrash,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { TopLevelServerType } from "../../../Api/GameServer";
import { isBusy, isRunning, useServerActions } from "../../Server/useServerActions";
import { serverPath } from "../../Server/serverUtils";

/** Start/stop button and ⋯ menu at the end of each row. */
const ServerRowActions: React.FC<{ server: TopLevelServerType }> = ({ server }) => {
    const actions = useServerActions();
    const navigate = useNavigate();
    const running = isRunning(server);
    const busy = isBusy(server);

    return (
        <Group gap={4} justify="flex-end" wrap="nowrap" onClick={e => e.stopPropagation()}>
            <Tooltip label={busy ? 'Working…' : running ? 'Stop' : 'Start'} withArrow>
                <ActionIcon
                    variant="light"
                    color={running ? 'red' : 'green'}
                    disabled={busy}
                    onClick={() => actions.toggle(server)}
                    aria-label={running ? `Stop ${server.Name}` : `Start ${server.Name}`}
                >
                    {busy ? <Loader size={14} color="gray" /> : running ? <IconPlayerStopFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" shadow="md" width={190} withinPortal>
                <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label={`More actions for ${server.Name}`}>
                        <IconDots size={16} />
                    </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                    <Menu.Item leftSection={<IconExternalLink size={14} />} onClick={() => navigate(serverPath(server))}>
                        Open server page
                    </Menu.Item>
                    <Menu.Item leftSection={<IconRestore size={14} />} disabled={!running || busy} onClick={() => actions.restart(server)}>
                        Restart
                    </Menu.Item>
                    {server.IsOwner && (
                        <>
                            <Menu.Item leftSection={<IconShare size={14} />} onClick={() => actions.openShare(server)}>
                                Share…
                            </Menu.Item>
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => actions.confirmDelete(server)}>
                                Delete…
                            </Menu.Item>
                        </>
                    )}
                </Menu.Dropdown>
            </Menu>
        </Group>
    );
};

export default ServerRowActions;
