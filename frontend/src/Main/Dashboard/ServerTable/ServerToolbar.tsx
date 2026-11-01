import { forwardRef } from "react";
import { Button, Chip, CloseButton, Group, Kbd, SegmentedControl, Select, TextInput, Tooltip } from "@mantine/core";
import { IconPlus, IconSearch } from "@tabler/icons-react";

import { gameIconFact } from "../../../Shared/Util";
import { DEFAULT_FILTERS, ScopeFilter, ServerFilters, StatusFilter, isFiltered } from "../../Server/serverUtils";

interface ServerToolbarProps {
    filters: ServerFilters;
    onChange: (filters: ServerFilters) => void;
    gameTypes: string[];
    hasShared: boolean;
    onAdd: () => void;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Any status' },
    { value: 'running', label: 'Running' },
    { value: 'stopped', label: 'Stopped' },
    { value: 'busy', label: 'In progress' },
    { value: 'failed', label: 'Failed' },
];

/** Search, filters and the Add Server button above the servers table. */
const ServerToolbar = forwardRef<HTMLInputElement, ServerToolbarProps>(({ filters, onChange, gameTypes, hasShared, onAdd }, searchRef) => {
    const set = (changes: Partial<ServerFilters>) => onChange({ ...filters, ...changes });

    return (
        <Group justify="space-between" align="flex-end" gap="sm">
            <Group gap="sm" align="center">
                <TextInput
                    ref={searchRef}
                    placeholder="Search servers"
                    leftSection={<IconSearch size={16} />}
                    rightSection={
                        filters.search
                            ? <CloseButton size="sm" onClick={() => set({ search: '' })} aria-label="Clear search" />
                            : <Tooltip label="Press / to search"><Kbd size="xs">/</Kbd></Tooltip>
                    }
                    value={filters.search}
                    onChange={e => set({ search: e.currentTarget.value })}
                    onKeyDown={e => e.key === 'Escape' && e.currentTarget.blur()}
                    w={{ base: '100%', xs: 240 }}
                    aria-label="Search servers"
                />
                {hasShared && (
                    <SegmentedControl
                        size="xs"
                        value={filters.scope}
                        onChange={value => set({ scope: value as ScopeFilter })}
                        data={[
                            { value: 'all', label: 'All' },
                            { value: 'mine', label: 'Mine' },
                            { value: 'shared', label: 'Shared with me' },
                        ]}
                    />
                )}
                {gameTypes.length > 1 && (
                    <Chip.Group multiple value={filters.games} onChange={games => set({ games })}>
                        <Group gap={6}>
                            {gameTypes.map(game => (
                                <Chip key={game} value={game} size="xs" variant="light" icon={gameIconFact('0.9rem').get(game)}>
                                    {game}
                                </Chip>
                            ))}
                        </Group>
                    </Chip.Group>
                )}
                <Select
                    size="xs"
                    w={130}
                    value={filters.status}
                    onChange={value => set({ status: (value ?? 'all') as StatusFilter })}
                    data={STATUS_OPTIONS}
                    allowDeselect={false}
                    aria-label="Filter by status"
                />
                {isFiltered(filters) && (
                    <Button size="xs" variant="subtle" color="gray" onClick={() => onChange(DEFAULT_FILTERS)}>
                        Clear filters
                    </Button>
                )}
            </Group>
            <Button leftSection={<IconPlus size={18} />} onClick={onAdd}>
                Add Server
            </Button>
        </Group>
    );
});

export default ServerToolbar;
