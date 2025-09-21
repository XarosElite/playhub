import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Card, Group, Text, Title } from "@mantine/core";
import { AreaChart, AreaChartSeries, ChartData } from "@mantine/charts";

import { SystemInfoContext } from "../../../Store/SystemInfoStore";

import classes from './SystemInfo.module.scss';

const SystemInfo = observer(() => {
    const systemInfoStore = useContext(SystemInfoContext);

    return (
        <div>
            <Title order={2} mb={16}>System Information</Title>
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
