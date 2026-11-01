import React from "react";
import { Alert, Avatar, Button, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconExternalLink, IconRestore, IconShare, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { TopLevelServerType } from "../../../Api/GameServer";
import { displayUserName } from "../../../Api/Users";
import CopyAddress from "../../../Shared/Components/CopyAddress";
import RelativeTime from "../../../Shared/Components/RelativeTime";
import AnimatedNumber from "../../../Shared/Components/AnimatedNumber";
import { formatMemory, serverAddress, serverPath } from "../../Server/serverUtils";
import { isBusy, isRunning, useServerActions } from "../../Server/useServerActions";

import classes from './ServerTable.module.scss';

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
        <div>{children}</div>
    </Stack>
);

/** Summary shown when a row is expanded. */
const ServerExpansion: React.FC<{ server: TopLevelServerType; hostIp: string }> = ({ server, hostIp }) => {
    const actions = useServerActions();
    const navigate = useNavigate();
    const running = isRunning(server);
    const live = server.Live;

    return (
        <Stack className={classes.expansion} gap="md">
            {server.StatusMessage && (
                <Alert
                    variant="light"
                    color={server.State === 'failed' ? 'red' : 'yellow'}
                    icon={<IconAlertTriangle size={18} />}
                    p="xs"
                >
                    {server.StatusMessage}
                </Alert>
            )}
            <SimpleGrid cols={{ base: 2, sm: 3, xl: 6 }} spacing="lg">
                <Detail label={`Address · ${server.Protocol.toUpperCase()}`}>
                    <CopyAddress address={serverAddress(server, hostIp)} />
                </Detail>
                <Detail label="Players">
                    <Text size="sm">
                        {server.SupportsPlayers && live?.players
                            ? <><AnimatedNumber value={live.players.online} /> / {live.players.max}</>
                            : server.SupportsPlayers && running ? 'Waiting for server…' : '—'}
                    </Text>
                </Detail>
                <Detail label="Uptime">
                    {running && live?.started_at
                        ? <RelativeTime date={live.started_at} mode="duration" size="sm" />
                        : <Text size="sm">—</Text>}
                </Detail>
                <Detail label="Memory">
                    <Text size="sm">{live ? `${formatMemory(live.mem_used_mb)} / ${formatMemory(live.mem_limit_mb)}` : '—'}</Text>
                </Detail>
                <Detail label="Created">
                    <RelativeTime date={server.Created} size="sm" />
                </Detail>
                <Detail label="Owner">
                    <Group gap={6} wrap="nowrap">
                        <Avatar src={server.Owner.picture} size={20} radius="xl" color="green">
                            {displayUserName(server.Owner).charAt(0).toUpperCase()}
                        </Avatar>
                        <Text size="sm" truncate>{server.IsOwner ? 'You' : displayUserName(server.Owner)}</Text>
                    </Group>
                </Detail>
            </SimpleGrid>
            <Group gap="xs">
                <Button size="xs" variant="light" leftSection={<IconExternalLink size={14} />} onClick={() => navigate(serverPath(server))}>
                    Open server page
                </Button>
                <Button size="xs" variant="default" leftSection={<IconRestore size={14} />} disabled={!running || isBusy(server)} onClick={() => actions.restart(server)}>
                    Restart
                </Button>
                {server.IsOwner && (
                    <>
                        <Button size="xs" variant="default" leftSection={<IconShare size={14} />} onClick={() => actions.openShare(server)}>
                            Share
                        </Button>
                        <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => actions.confirmDelete(server)}>
                            Delete
                        </Button>
                    </>
                )}
            </Group>
        </Stack>
    );
};

export default ServerExpansion;
