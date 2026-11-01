import React from "react";
import { Button, CloseButton, Group, Paper, Text } from "@mantine/core";
import { IconPlayerPlayFilled, IconPlayerStopFilled, IconRestore, IconTrash } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { TopLevelServerType } from "../../../Api/GameServer";
import { spring } from "../../../Shared/motion";
import { useServerActions } from "../../Server/useServerActions";

interface BulkActionBarProps {
    selected: TopLevelServerType[];
    onClear: () => void;
}

/** Floating bar for acting on several selected servers at once. */
const BulkActionBar: React.FC<BulkActionBarProps> = ({ selected, onClear }) => {
    const actions = useServerActions();

    return (
        <AnimatePresence>
            {selected.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 24, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 24, scale: 0.98 }}
                    transition={spring}
                    style={{ position: 'fixed', bottom: 24, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 200, pointerEvents: 'none' }}
                >
                    <Paper shadow="xl" radius="xl" px="md" py="xs" withBorder style={{ pointerEvents: 'auto' }}>
                        <Group gap="sm" wrap="nowrap">
                            <Text size="sm" fw={600} miw={90}>{selected.length} selected</Text>
                            <Button size="xs" variant="light" color="green" leftSection={<IconPlayerPlayFilled size={12} />} onClick={() => actions.bulk(selected, 'start')}>
                                Start
                            </Button>
                            <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStopFilled size={12} />} onClick={() => actions.bulk(selected, 'stop')}>
                                Stop
                            </Button>
                            <Button size="xs" variant="light" leftSection={<IconRestore size={14} />} onClick={() => actions.bulk(selected, 'restart')}>
                                Restart
                            </Button>
                            <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => actions.confirmBulkDelete(selected, onClear)}>
                                Delete
                            </Button>
                            <CloseButton size="sm" onClick={onClear} aria-label="Clear selection" />
                        </Group>
                    </Paper>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default BulkActionBar;
