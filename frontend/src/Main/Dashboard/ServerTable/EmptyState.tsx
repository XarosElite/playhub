import React from "react";
import { Button, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconFilterOff, IconPlus, IconServer2 } from "@tabler/icons-react";
import { motion } from "motion/react";

import { fadeUp, stagger } from "../../../Shared/motion";

interface EmptyStateProps {
    // true: there are servers but none match the filters.
    filtered: boolean;
    onAdd: () => void;
    onClearFilters: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ filtered, onAdd, onClearFilters }) => (
    <motion.div variants={stagger(0.08)} initial="hidden" animate="visible">
        <Stack align="center" gap="sm" py={48} px="md" ta="center">
            <motion.div variants={fadeUp}>
                <ThemeIcon size={64} radius="xl" variant="light" color={filtered ? 'gray' : 'green'}>
                    {filtered ? <IconFilterOff size={32} stroke={1.5} /> : <IconServer2 size={32} stroke={1.5} />}
                </ThemeIcon>
            </motion.div>
            <motion.div variants={fadeUp}>
                <Title order={3}>{filtered ? 'No servers match' : 'No servers yet'}</Title>
            </motion.div>
            <motion.div variants={fadeUp}>
                <Text c="dimmed" maw={360}>
                    {filtered
                        ? 'Try a different search or clear the filters.'
                        : 'Spin up a Minecraft or Palworld server in a couple of clicks. Servers shared with you show up here too.'}
                </Text>
            </motion.div>
            <motion.div variants={fadeUp}>
                {filtered
                    ? <Button variant="light" leftSection={<IconFilterOff size={16} />} onClick={onClearFilters}>Clear filters</Button>
                    : <Button leftSection={<IconPlus size={18} />} onClick={onAdd}>Add your first server</Button>}
            </motion.div>
        </Stack>
    </motion.div>
);

export default EmptyState;
