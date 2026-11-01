import React from "react";
import { Badge, MantineColor, Tooltip } from "@mantine/core";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";

import { ServerState, TRANSITIONAL_STATES } from "../../../Api/GameServer";
import { DURATION } from "../../motion";

import classes from "./StatusBadge.module.scss";

const STATUS: Record<ServerState, { label: string; color: MantineColor }> = {
    running: { label: 'Running', color: 'green' },
    starting: { label: 'Starting', color: 'yellow' },
    restarting: { label: 'Restarting', color: 'yellow' },
    updating: { label: 'Updating', color: 'yellow' },
    stopping: { label: 'Stopping', color: 'orange' },
    exited: { label: 'Stopped', color: 'gray' },
    created: { label: 'Stopped', color: 'gray' },
    failed: { label: 'Failed', color: 'red' },
};

interface StatusBadgeProps {
    state: ServerState;
    message?: string | null;
    // Lets celebrations find the badge on screen.
    serverId?: string;
    size?: 'sm' | 'md' | 'lg';
    // Just a coloured dot (label in the tooltip), for narrow screens.
    compact?: boolean;
}

/**
 * Server status pill. Transitional states pulse; changes cross-fade; a tooltip
 * explains failures and unexpected stops.
 */
const StatusBadge: React.FC<StatusBadgeProps> = ({ state, message, serverId, size = 'md', compact = false }) => {
    const status = STATUS[state] ?? { label: state, color: 'gray' };
    const busy = TRANSITIONAL_STATES.has(state);

    if (compact) {
        return (
            <Tooltip label={message ? `${status.label}: ${message}` : status.label} withArrow>
                <Badge
                    data-status-badge={serverId}
                    color={status.color}
                    variant="filled"
                    size="sm"
                    circle
                    className={clsx(classes.badge, busy && classes.busy)}
                    aria-label={status.label}
                >
                    <span className={clsx(classes.dot, busy && classes.dotPulse)} />
                </Badge>
            </Tooltip>
        );
    }

    const badge = (
        <Badge
            data-status-badge={serverId}
            color={status.color}
            variant={state === 'exited' || state === 'created' ? 'light' : 'filled'}
            size={size}
            className={clsx(classes.badge, busy && classes.busy)}
            miw={size === 'lg' ? 120 : 104}
            leftSection={<span className={clsx(classes.dot, busy && classes.dotPulse)} />}
        >
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                    key={status.label}
                    className={classes.label}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: DURATION.fast }}
                >
                    {status.label}
                </motion.span>
            </AnimatePresence>
        </Badge>
    );

    return message ? <Tooltip label={message} multiline maw={320} withArrow>{badge}</Tooltip> : badge;
};

export default StatusBadge;
