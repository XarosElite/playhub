import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Card, Collapse, Group, Text, Title, UnstyledButton } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { IconChevronDown } from "@tabler/icons-react";
import clsx from "clsx";
import { AreaChart, AreaChartSeries, ChartData } from "@mantine/charts";

import { SystemInfoContext } from "../../../Store/SystemInfoStore";

import classes from './SystemInfo.module.scss';

const SystemInfo = observer(() => {
    const systemInfoStore = useContext(SystemInfoContext);
    const [expanded, setExpanded] = useLocalStorage<boolean>({
        key: 'playhub-system-info-expanded',
        defaultValue: true,
        getInitialValueInEffect: false,
    });
    const latest = systemInfoStore.latestSystemInfo?.sys_info;

    return (
        <div>
            <UnstyledButton
                className={classes.header}
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-controls="system-info-panel"
            >
                <Group gap="sm" wrap="nowrap">
                    <IconChevronDown
                        size={22}
                        stroke={2}
                        className={clsx(classes.chevron, !expanded && classes.chevronCollapsed)}
                    />
                    <Title order={2}>System Information</Title>
                </Group>
                {!expanded && latest && (
                    <Group gap="lg" wrap="nowrap" visibleFrom="xs">
                        <Text size="sm" c="dimmed">CPU <Text span fw={600} c="var(--mantine-color-text)">{latest.cpu_usage}%</Text></Text>
                        <Text size="sm" c="dimmed">RAM <Text span fw={600} c="var(--mantine-color-text)">{latest.used_ram_pct}%</Text> ({latest.used_ram_gb} GB)</Text>
                    </Group>
                )}
            </UnstyledButton>
            <Collapse in={expanded} id="system-info-panel">
            <div className={classes.sysInfoContainer}>
                <SystemCard
                    title="Total CPU Usage"
                    data={systemInfoStore.systemHistory.map(item => item.sys_info)}
                    series={[{name: 'cpu_usage', label: 'CPU usage', color: 'green.3'}]}
                    dataKey="time"
                    label="Usage (%)"
                >
                    <Group gap={6}>
                        <Text size="lg" fw={600}>Usage:</Text>
                        <Text size="lg">{systemInfoStore.latestSystemInfo?.sys_info.cpu_usage}%</Text>
                    </Group>
                </SystemCard>
                <SystemCard
                    title="Total Memory Usage"
                    data={systemInfoStore.systemHistory.map(item => item.sys_info)}
                    series={[{name: 'used_ram_pct', label: 'RAM usage', color: 'green.9'}]}
                    dataKey="time"
                    label="Usage (%)"
                >
                    <Group gap={6}>
                        <Text size="lg" fw={600}>Usage:</Text>
                        <Text size="lg" fs="italic">
                            {systemInfoStore.latestSystemInfo?.sys_info.used_ram_pct}% ({systemInfoStore.latestSystemInfo?.sys_info.used_ram_gb}  GB)
                        </Text>
                    </Group>
                </SystemCard>
            </div>
            </Collapse>
        </div>
    )
});

interface SystemCardProps {
    title: string;
    dataKey: string;
    data: ChartData;
    series: AreaChartSeries[];
    label: string;
    children?: React.ReactElement;
}

/**
 * Renders a system card
 */
const SystemCard: React.FC<SystemCardProps> = ({title, data, series, dataKey, label, children}) => {
    return(
        <Card padding="md" shadow="md" className={classes.systemCard}>
            <Title order={4}>{title}</Title>
            <Card.Section>
                <AreaChart
                    className={classes.areaChart}
                    m={32}
                    h={175}
                    data={data}
                    series={series}
                    opacity={1}
                    strokeWidth={2}
                    dataKey={dataKey}
                    withXAxis={false}
                    yAxisLabel={label}
                    yAxisProps={{domain: [0, 100]}}
                    curveType='linear'
                    withDots={false}
                />
            </Card.Section>
            <Card.Section p='lg'>
                {children}
            </Card.Section>
        </Card>
    )
}

export default SystemInfo;
