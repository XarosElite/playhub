import React from "react";
import { observer } from "mobx-react";
import { Alert, Card, Group, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { AreaChart } from "@mantine/charts";
import { IconAlertTriangle, IconClock, IconCpu, IconDatabase, IconUsers } from "@tabler/icons-react";
import { motion } from "motion/react";
import { format } from "date-fns";

import { TopLevelServerType } from "../../Api/GameServer";
import AnimatedNumber from "../../Shared/Components/AnimatedNumber";
import RelativeTime from "../../Shared/Components/RelativeTime";
import { fadeUp, stagger } from "../../Shared/motion";
import { formatMemory } from "./serverUtils";

const StatCard: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode; hint?: React.ReactNode }> =
    ({ icon, label, children, hint }) => (
        <motion.div variants={fadeUp} whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
            <Card withBorder padding="md" radius="md" h="100%">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                    <ThemeIcon size="lg" radius="md" variant="light" color="green">{icon}</ThemeIcon>
                    <Stack gap={0}>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
                        <Text size="xl" fw={700}>{children}</Text>
                        {hint && <Text size="xs" c="dimmed">{hint}</Text>}
                    </Stack>
                </Group>
            </Card>
        </motion.div>
    );

/** Live numbers and charts for one server. */
const OverviewPanel: React.FC<{ server: TopLevelServerType }> = observer(({ server }) => {
    const live = server.Live;
    const running = server.State === 'running';
    const history = (live?.history ?? []).map(point => ({
        time: format(new Date(point.time), 'h:mm:ss a'),
        cpu: point.cpu_pct ?? 0,
        memory: point.mem_used_mb ?? 0,
    }));

    return (
        <Stack gap="lg">
            {server.StatusMessage && (
                <Alert variant="light" color={server.State === 'failed' ? 'red' : 'yellow'} icon={<IconAlertTriangle size={18} />}>
                    {server.StatusMessage}
                </Alert>
            )}

            <motion.div variants={stagger(0.06)} initial="hidden" animate="visible">
                <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
                    <StatCard
                        icon={<IconUsers size={20} />}
                        label="Players"
                        hint={live?.players?.version ? `Version ${live.players.version}` : !server.SupportsPlayers ? 'Not available for this game' : undefined}
                    >
                        {server.SupportsPlayers && live?.players
                            ? <><AnimatedNumber value={live.players.online} /> <Text span c="dimmed" size="md">/ {live.players.max}</Text></>
                            : '—'}
                    </StatCard>
                    <StatCard icon={<IconCpu size={20} />} label="CPU" hint="of the host">
                        <AnimatedNumber value={running ? live?.cpu_pct : null} decimals={1} suffix="%" />
                    </StatCard>
                    <StatCard icon={<IconDatabase size={20} />} label="Memory" hint={live?.mem_limit_mb ? `of ${formatMemory(live.mem_limit_mb)}` : undefined}>
                        {running && live ? formatMemory(live.mem_used_mb) : '—'}
                    </StatCard>
                    <StatCard icon={<IconClock size={20} />} label="Uptime">
                        {running && live?.started_at ? <RelativeTime date={live.started_at} mode="duration" /> : '—'}
                    </StatCard>
                </SimpleGrid>
            </motion.div>

            {running && history.length > 1 ? (
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                    <Card withBorder radius="md" padding="md">
                        <Text fw={600} mb="sm">CPU (last 2 minutes)</Text>
                        <AreaChart h={180} data={history} dataKey="time" series={[{ name: 'cpu', label: 'CPU %', color: 'green.5' }]}
                            withXAxis={false} withDots={false} curveType="monotone" yAxisProps={{ domain: [0, 'auto'] }} unit="%" />
                    </Card>
                    <Card withBorder radius="md" padding="md">
                        <Text fw={600} mb="sm">Memory (last 2 minutes)</Text>
                        <AreaChart h={180} data={history} dataKey="time" series={[{ name: 'memory', label: 'Memory MB', color: 'teal.6' }]}
                            withXAxis={false} withDots={false} curveType="monotone" unit=" MB" />
                    </Card>
                </SimpleGrid>
            ) : (
                <Text size="sm" c="dimmed">
                    {running ? 'Collecting resource history…' : 'Start the server to see live resource usage.'}
                </Text>
            )}
        </Stack>
    );
});

export default OverviewPanel;
