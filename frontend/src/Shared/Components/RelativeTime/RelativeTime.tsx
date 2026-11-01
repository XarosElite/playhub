import React from "react";
import { Text, TextProps, Tooltip } from "@mantine/core";
import { format, formatDistanceStrict } from "date-fns";

import { useNow } from "../../Hooks/useNow";

interface RelativeTimeProps extends TextProps {
    date: string | Date;
    // e.g. "Created" → "Created 3 days ago"
    prefix?: string;
    // Show a duration ("for 2 hours") instead of "… ago".
    mode?: 'ago' | 'duration';
}

/** "3 days ago" (or a duration), with the exact time on hover. Updates itself. */
const RelativeTime: React.FC<RelativeTimeProps> = ({ date, prefix, mode = 'ago', ...textProps }) => {
    const now = useNow();
    const value = new Date(date);
    if (isNaN(value.getTime())) return <Text span {...textProps}>—</Text>;

    const distance = formatDistanceStrict(value, now);
    const label = mode === 'ago' ? `${distance} ago` : distance;

    return (
        <Tooltip label={format(value, 'PPpp')} withArrow openDelay={300}>
            <Text span {...textProps}>{prefix ? `${prefix} ${label}` : label}</Text>
        </Tooltip>
    );
};

export default RelativeTime;
