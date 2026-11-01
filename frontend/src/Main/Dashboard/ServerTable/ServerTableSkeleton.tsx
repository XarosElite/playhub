import React from "react";
import { Group, Paper, Skeleton, Stack } from "@mantine/core";

/** Placeholder rows shown until the first server list arrives. */
const ServerTableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
    <Paper withBorder radius="sm" p="md" aria-busy="true" aria-label="Loading servers">
        <Stack gap="lg">
            <Group gap="xl"><Skeleton h={12} w="18%" /><Skeleton h={12} w="10%" /><Skeleton h={12} w="10%" /><Skeleton h={12} w="12%" /></Group>
            {Array.from({ length: rows }, (_, i) => (
                <Group key={i} gap="xl" wrap="nowrap" style={{ opacity: 1 - i * 0.14 }}>
                    <Skeleton h={18} w="22%" radius="sm" />
                    <Skeleton h={18} w="12%" radius="sm" />
                    <Skeleton h={22} w={80} radius="xl" />
                    <Skeleton h={18} w="10%" radius="sm" />
                    <Skeleton h={28} w={110} radius="sm" />
                    <Skeleton h={18} w="14%" radius="sm" ml="auto" />
                </Group>
            ))}
        </Stack>
    </Paper>
);

export default ServerTableSkeleton;
