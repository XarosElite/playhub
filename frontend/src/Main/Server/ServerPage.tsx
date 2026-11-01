import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
    Anchor, Avatar, Button, Group, Menu, Paper, Skeleton, Stack, Tabs, Text, Title, Tooltip,
} from "@mantine/core";
import {
    IconActivity, IconArrowLeft, IconChevronDown, IconLayoutDashboard, IconPlayerPlayFilled, IconPlayerStopFilled,
    IconRestore, IconSettings, IconShare, IconTerminal2, IconFileText, IconTrash, IconUsers,
} from "@tabler/icons-react";

import { ServerStoreContext } from "../../Store/ServerStore";
import { SystemInfoContext } from "../../Store/SystemInfoStore";
import { displayUserName } from "../../Api/Users";
import { gameIconFact } from "../../Shared/Util";
import StatusBadge from "../../Shared/Components/StatusBadge";
import CopyAddress from "../../Shared/Components/CopyAddress";
import ServerTerminal from "../Dashboard/ServerTerminal";
import OverviewPanel from "./OverviewPanel";
import LogViewer from "./LogViewer";
import SettingsPanel from "./SettingsPanel";
import SharePanel from "./SharePanel";
import ActivityTimeline from "./ActivityTimeline";
import { isBusy, isRunning, useServerActions } from "./useServerActions";
import { serverAddress } from "./serverUtils";

import classes from "./ServerPage.module.scss";

const TABS = ['overview', 'console', 'terminal', 'settings', 'sharing', 'activity'] as const;
type Tab = typeof TABS[number];

/** Everything about one server: live overview, console, terminal, settings, sharing and history. */
const ServerPage: React.FC = observer(() => {
    const { serverId } = useParams();
    const serverStore = useContext(ServerStoreContext);
    const systemInfoStore = useContext(SystemInfoContext);
    const actions = useServerActions();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();

    const server = serverStore.byId(serverId);
    const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;
    const setTab = (value: string | null) => setParams(value && value !== 'overview' ? { tab: value } : {}, { replace: true });

    if (!serverStore.loaded) {
        return (
            <Stack gap="lg">
                <Skeleton h={20} w={120} />
                <Group><Skeleton h={48} w={48} circle /><Skeleton h={32} w={260} /></Group>
                <Skeleton h={36} w="100%" />
                <Group grow><Skeleton h={96} /><Skeleton h={96} /><Skeleton h={96} /><Skeleton h={96} /></Group>
            </Stack>
        );
    }

    if (!server) {
        return (
            <Paper withBorder p="xl" radius="md">
                <Stack align="center" gap="sm">
                    <Title order={3}>Server not found</Title>
                    <Text c="dimmed">It may have been deleted, or it's no longer shared with you.</Text>
                    <Button component={Link} to="/" leftSection={<IconLayoutDashboard size={16} />} variant="light">Back to dashboard</Button>
                </Stack>
            </Paper>
        );
    }

    const running = isRunning(server);
    const busy = isBusy(server);

    return (
        <Stack gap="lg">
            <Anchor component={Link} to="/" size="sm" c="dimmed" className={classes.back}>
                <IconArrowLeft size={14} /> Servers
            </Anchor>

            <Group justify="space-between" align="flex-start" gap="md">
                <Group gap="md" wrap="nowrap">
                    <div className={classes.gameIcon}>{gameIconFact('2.5rem').get(server.GameType)}</div>
                    <Stack gap={4}>
                        <Group gap="sm">
                            <Title order={2}>{server.Name}</Title>
                            <StatusBadge state={server.State} message={server.StatusMessage} serverId={server.ID} size="lg" />
                        </Group>
                        <Group gap="md">
                            <CopyAddress address={serverAddress(server, systemInfoStore.systemIP)} />
                            <Text size="sm" c="dimmed" tt="capitalize">{server.GameType} · {server.Protocol.toUpperCase()}</Text>
                            {!server.IsOwner && (
                                <Group gap={6}>
                                    <Avatar src={server.Owner.picture} size={18} radius="xl" color="green">
                                        {displayUserName(server.Owner).charAt(0).toUpperCase()}
                                    </Avatar>
                                    <Text size="sm" c="dimmed">Shared by {displayUserName(server.Owner)}</Text>
                                </Group>
                            )}
                            {server.IsOwner && !!server.SharedWith?.length && (
                                <Tooltip label={server.SharedWith.map(displayUserName).join(', ')}>
                                    <Group gap={4}>
                                        <IconUsers size={14} />
                                        <Text size="sm" c="dimmed">Shared with {server.SharedWith.length}</Text>
                                    </Group>
                                </Tooltip>
                            )}
                        </Group>
                    </Stack>
                </Group>

                <Group gap="xs">
                    <Button
                        color={running ? 'red' : 'green'}
                        variant={running ? 'light' : 'filled'}
                        leftSection={running ? <IconPlayerStopFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                        loading={busy}
                        onClick={() => actions.toggle(server)}
                    >
                        {running ? 'Stop' : 'Start'}
                    </Button>
                    <Button variant="default" leftSection={<IconRestore size={16} />} disabled={!running || busy} onClick={() => actions.restart(server)}>
                        Restart
                    </Button>
                    {server.IsOwner && (
                        <Menu position="bottom-end" shadow="md" withinPortal>
                            <Menu.Target>
                                <Button variant="default" rightSection={<IconChevronDown size={14} />}>More</Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item leftSection={<IconShare size={14} />} onClick={() => setTab('sharing')}>Share…</Menu.Item>
                                <Menu.Divider />
                                <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => actions.confirmDelete(server, () => navigate('/'))}>
                                    Delete…
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    )}
                </Group>
            </Group>

            <Tabs value={tab} onChange={setTab} keepMounted={false} classNames={{ tab: classes.tab }}>
                <Tabs.List>
                    <Tabs.Tab value="overview" leftSection={<IconLayoutDashboard size={16} />}>Overview</Tabs.Tab>
                    <Tabs.Tab value="console" leftSection={<IconFileText size={16} />}>Console</Tabs.Tab>
                    <Tabs.Tab value="terminal" leftSection={<IconTerminal2 size={16} />}>Terminal</Tabs.Tab>
                    <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>Settings</Tabs.Tab>
                    {server.IsOwner && <Tabs.Tab value="sharing" leftSection={<IconShare size={16} />}>Sharing</Tabs.Tab>}
                    <Tabs.Tab value="activity" leftSection={<IconActivity size={16} />}>Activity</Tabs.Tab>
                </Tabs.List>

                <div className={classes.tabPanel}>
                    <Tabs.Panel value="overview"><OverviewPanel server={server} /></Tabs.Panel>
                    <Tabs.Panel value="console"><LogViewer serverId={server.Name} running={running} /></Tabs.Panel>
                    <Tabs.Panel value="terminal">
                        {running
                            ? <ServerTerminal serverId={server.Name} serverName={server.Name} />
                            : <Text c="dimmed">Start the server to open a terminal.</Text>}
                    </Tabs.Panel>
                    <Tabs.Panel value="settings"><SettingsPanel server={server} onSaved={serverStore.refresh} /></Tabs.Panel>
                    {server.IsOwner && (
                        <Tabs.Panel value="sharing">
                            <Paper withBorder p="lg" radius="md" maw={560}>
                                <SharePanel server={server} onSaved={serverStore.refresh} />
                            </Paper>
                        </Tabs.Panel>
                    )}
                    <Tabs.Panel value="activity">
                        <ActivityTimeline serverId={server.Name} refreshKey={`${server.State}|${server.SharedWith?.length ?? 0}`} />
                    </Tabs.Panel>
                </div>
            </Tabs>
        </Stack>
    );
});

export default ServerPage;
