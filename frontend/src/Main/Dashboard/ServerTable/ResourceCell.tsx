import React from "react";
import { Group, Stack, Text } from "@mantine/core";
import { Sparkline } from "@mantine/charts";

import { ServerLiveType } from "../../../Api/GameServer";
import AnimatedNumber from "../../../Shared/Components/AnimatedNumber";
import { formatMemory } from "../../Server/serverUtils";

/** CPU sparkline plus current CPU and memory for a running server. */
const ResourceCell: React.FC<{ live: ServerLiveType | null }> = ({ live }) => {
    if (!live) return <Text size="sm" c="dimmed">—</Text>;
    const history = (live.history ?? []).map(point => point.cpu_pct ?? 0);

    return (
        <Group gap="sm" wrap="nowrap">
            <Sparkline
                w={72}
                h={28}
                data={history.length > 1 ? history : [0, 0]}
                curveType="monotone"
                color="green.5"
                fillOpacity={0.25}
                strokeWidth={1.5}
                aria-label="CPU usage over the last two minutes"
            />
            <Stack gap={0}>
                <Text size="xs" fw={600}><AnimatedNumber value={live.cpu_pct} decimals={1} suffix="%" /> CPU</Text>
                <Text size="xs" c="dimmed">{formatMemory(live.mem_used_mb)}</Text>
            </Stack>
        </Group>
    );
};

export default ResourceCell;
