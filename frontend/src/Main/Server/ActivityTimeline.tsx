import React, { useEffect, useState } from "react";
import { Avatar, Group, Loader, Text, ThemeIcon, Timeline } from "@mantine/core";
import {
    IconAlertTriangle, IconCirclePlus, IconPlayerPlay, IconPlayerStop, IconRestore, IconSettings, IconShare,
    IconTrash, IconUserMinus, IconBolt,
} from "@tabler/icons-react";
import { motion } from "motion/react";

import { GameServerApi, ServerEventAction, ServerEventType } from "../../Api/GameServer";
import { displayUserName } from "../../Api/Users";
import RelativeTime from "../../Shared/Components/RelativeTime";
import { fadeUp, stagger } from "../../Shared/motion";

const EVENT: Record<ServerEventAction, { icon: React.ReactNode; color: string; text: (detail: string | null) => string }> = {
    created: { icon: <IconCirclePlus size={14} />, color: 'green', text: () => 'created the server' },
    started: { icon: <IconPlayerPlay size={14} />, color: 'green', text: () => 'started the server' },
    stopped: { icon: <IconPlayerStop size={14} />, color: 'gray', text: () => 'stopped the server' },
    restarted: { icon: <IconRestore size={14} />, color: 'blue', text: () => 'restarted the server' },
    settings_updated: { icon: <IconSettings size={14} />, color: 'blue', text: d => `changed ${d ?? 'settings'}` },
    shared: { icon: <IconShare size={14} />, color: 'violet', text: d => `shared it with ${d}` },
    unshared: { icon: <IconUserMinus size={14} />, color: 'gray', text: d => `stopped sharing with ${d}` },
    deleted: { icon: <IconTrash size={14} />, color: 'red', text: () => 'deleted the server' },
    failed: { icon: <IconAlertTriangle size={14} />, color: 'red', text: d => d ?? 'A job failed' },
    crashed: { icon: <IconBolt size={14} />, color: 'orange', text: d => d ?? 'The server stopped unexpectedly' },
    missing: { icon: <IconAlertTriangle size={14} />, color: 'red', text: d => d ?? 'The container went missing' },
};

/** Who did what to a server, newest first. Reloads when `refreshKey` changes. */
const ActivityTimeline: React.FC<{ serverId: string; refreshKey: string }> = ({ serverId, refreshKey }) => {
    const [events, setEvents] = useState<ServerEventType[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        GameServerApi.getActivity(serverId)
            .then(result => !cancelled && setEvents(result))
            .catch(() => !cancelled && setEvents([]));
        return () => { cancelled = true; };
    }, [serverId, refreshKey]);

    if (events === null) return <Group justify="center" py="xl"><Loader size="sm" /></Group>;
    if (events.length === 0) return <Text c="dimmed" py="md">No activity yet.</Text>;

    return (
        <motion.div variants={stagger(0.04)} initial="hidden" animate="visible">
            <Timeline bulletSize={26} lineWidth={2}>
                {events.map(event => {
                    const meta = EVENT[event.action] ?? { icon: <IconBolt size={14} />, color: 'gray', text: () => event.action };
                    const system = event.actor === null;
                    return (
                        <Timeline.Item
                            key={event.id}
                            bullet={<ThemeIcon size={26} radius="xl" color={meta.color} variant="light">{meta.icon}</ThemeIcon>}
                        >
                            <motion.div variants={fadeUp}>
                                <Group gap={6} wrap="nowrap">
                                    {!system && (
                                        <Avatar src={event.actor?.picture} size={18} radius="xl" color="green">
                                            {displayUserName(event.actor).charAt(0).toUpperCase()}
                                        </Avatar>
                                    )}
                                    <Text size="sm">
                                        {!system && <Text span fw={600}>{displayUserName(event.actor)} </Text>}
                                        {meta.text(event.detail)}
                                    </Text>
                                </Group>
                                <RelativeTime date={event.created} size="xs" c="dimmed" />
                            </motion.div>
                        </Timeline.Item>
                    );
                })}
            </Timeline>
        </motion.div>
    );
};

export default ActivityTimeline;
