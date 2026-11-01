import React from "react";
import { ActionIcon, CopyButton, Group, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { DURATION } from "../../motion";

interface CopyAddressProps {
    address: string;
    size?: 'xs' | 'sm' | 'md';
    // Show the address text as well as the button.
    withText?: boolean;
}

/** One-click copy of a server's connect address, with a checkmark when copied. */
const CopyAddress: React.FC<CopyAddressProps> = ({ address, size = 'sm', withText = true }) => (
    <CopyButton value={address} timeout={1500}>
        {({ copied, copy }) => (
            <Group gap={4} wrap="nowrap" onClick={e => e.stopPropagation()}>
                {withText && <Text size={size} ff="monospace">{address}</Text>}
                <Tooltip label={copied ? 'Copied!' : 'Copy address'} withArrow>
                    <ActionIcon
                        variant="subtle"
                        color={copied ? 'green' : 'gray'}
                        size={size}
                        onClick={copy}
                        aria-label={`Copy ${address}`}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                                key={copied ? 'check' : 'copy'}
                                style={{ display: 'flex' }}
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.5, opacity: 0 }}
                                transition={{ duration: DURATION.fast }}
                            >
                                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                            </motion.span>
                        </AnimatePresence>
                    </ActionIcon>
                </Tooltip>
            </Group>
        )}
    </CopyButton>
);

export default CopyAddress;
