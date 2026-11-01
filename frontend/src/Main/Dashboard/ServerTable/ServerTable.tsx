import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure, useHotkeys, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import { IconChevronRight, IconUsers } from "@tabler/icons-react";
import { DataTable, DataTableSortStatus } from 'mantine-datatable';
import { useNavigate } from "react-router-dom";
import clsx from "clsx";

import { TopLevelServerType } from "../../../Api/GameServer";
import { displayUserName } from "../../../Api/Users";
import { SystemInfoContext } from "../../../Store/SystemInfoStore";
import { ServerStoreContext } from "../../../Store/ServerStore";
import { gameIconFact } from "../../../Shared/Util";
import StatusBadge from "../../../Shared/Components/StatusBadge";
import CopyAddress from "../../../Shared/Components/CopyAddress";
import RelativeTime from "../../../Shared/Components/RelativeTime";
import AnimatedNumber from "../../../Shared/Components/AnimatedNumber";
import { useFlipRows } from "../../../Shared/Hooks/useFlipRows";
import { MaybeLeaving, useExitingRecords } from "../../../Shared/Hooks/useExitingRecords";
import {
    DEFAULT_FILTERS, ServerFilters, SortKey, filterServers, isFiltered, serverAddress, serverPath, sortServers,
} from "../../Server/serverUtils";
import ServerModal from "../ServerModal";
import ServerToolbar from "./ServerToolbar";
import ServerRowActions from "./ServerRowActions";
import ServerExpansion from "./ServerExpansion";
import ResourceCell from "./ResourceCell";
import BulkActionBar from "./BulkActionBar";
import ServerTableSkeleton from "./ServerTableSkeleton";
import EmptyState from "./EmptyState";

import classes from './ServerTable.module.scss';

type Row = MaybeLeaving<TopLevelServerType>;

// Rows are keyed by name: a new server's ID changes from its name to the
// container ID once the container exists, and keying by ID would make the row
// animate out and back in (and lose its expanded state) at that moment.
const rowKey = (server: TopLevelServerType) => server.Name;

const ServerTable = observer(() => {
    const systemInfoStore = useContext(SystemInfoContext);
    const serverStore = useContext(ServerStoreContext);
    const navigate = useNavigate();

    const [addGameOpened, addGameHandlers] = useDisclosure(false);
    const [filters, setFilters] = useState<ServerFilters>(DEFAULT_FILTERS);
    const [sortStatus, setSortStatus] = useLocalStorage<DataTableSortStatus<TopLevelServerType>>({
        key: 'playhub-server-sort',
        defaultValue: { columnAccessor: 'Created', direction: 'asc' },
        getInitialValueInEffect: false,
    });
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const [selected, setSelected] = useState<TopLevelServerType[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);

    const isPhone = useMediaQuery('(max-width: 48em)') ?? false;
    const searchRef = useRef<HTMLInputElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);

    const all = serverStore.servers;
    const visible = useMemo(
        () => sortServers(filterServers(all, filters), sortStatus.columnAccessor as SortKey, sortStatus.direction),
        [all, filters, sortStatus],
    );
    const rows = useExitingRecords<TopLevelServerType>(visible, all, rowKey);
    useFlipRows(viewportRef, rows.map(rowKey));

    const gameTypes = useMemo(() => [...new Set(all.map(s => s.GameType))].sort(), [all]);
    const hasShared = all.some(s => !s.IsOwner);

    // Keep the selection in sync with the latest server data (and drop removed servers).
    useEffect(() => {
        setSelected(current => current
            .map(s => all.find(x => rowKey(x) === rowKey(s)))
            .filter((s): s is TopLevelServerType => !!s));
    }, [all]);

    // --- keyboard: / search, ↑↓ move, Enter expand, O open ---------------
    const moveActive = (delta: number) => {
        if (visible.length === 0) return;
        const index = visible.findIndex(s => rowKey(s) === activeId);
        const next = visible[Math.max(0, Math.min(visible.length - 1, index < 0 ? 0 : index + delta))];
        setActiveId(rowKey(next));
        viewportRef.current?.querySelector(`tr[data-row-id="${CSS.escape(rowKey(next))}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    const activeServer = visible.find(s => rowKey(s) === activeId);
    useHotkeys([
        ['/', () => searchRef.current?.focus()],
        ['ArrowDown', () => moveActive(1)],
        ['ArrowUp', () => moveActive(-1)],
        ['Enter', () => activeServer && toggleExpanded(rowKey(activeServer))],
        ['o', () => activeServer && navigate(serverPath(activeServer))],
    ]);

    const toggleExpanded = (id: string) =>
        setExpandedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

    const address = (server: TopLevelServerType) => serverAddress(server, systemInfoStore.systemIP);

    const toolbar = (
        <ServerToolbar
            ref={searchRef}
            filters={filters}
            onChange={setFilters}
            gameTypes={gameTypes}
            hasShared={hasShared}
            onAdd={addGameHandlers.open}
        />
    );

    const modal = <ServerModal closeHandler={addGameHandlers.close} opened={addGameOpened} onCreated={serverStore.refresh} />;

    if (!serverStore.loaded) {
        return <>{modal}{toolbar}<ServerTableSkeleton /></>;
    }

    if (visible.length === 0 && rows.length === 0) {
        return (
            <>
                {modal}
                {toolbar}
                <div className={classes.emptyWrapper}>
                    <EmptyState
                        filtered={all.length > 0 && isFiltered(filters)}
                        onAdd={addGameHandlers.open}
                        onClearFilters={() => setFilters(DEFAULT_FILTERS)}
                    />
                </div>
            </>
        );
    }

    return (
        <>
            {modal}
            {toolbar}
            <div className={classes.tableWrapper}>
                <div className={classes.tableFill}>
                <DataTable<Row>
                    height="100%"
                    idAccessor="Name"
                    withTableBorder
                    highlightOnHover
                    scrollViewportRef={viewportRef}
                    className={classes.table}
                    rowClassName={record => clsx(
                        classes.row,
                        record.__leaving && classes.rowLeaving,
                        rowKey(record) === activeId && classes.rowActive,
                    )}
                    customRowAttributes={record => ({ 'data-row-id': rowKey(record) })}
                    onRowClick={({ record }) => setActiveId(rowKey(record))}
                    onRowDoubleClick={({ record }) => navigate(serverPath(record))}
                    // Bulk selection is a desktop workflow; phones get the room for the name instead.
                    selectedRecords={isPhone ? undefined : selected}
                    onSelectedRecordsChange={isPhone ? undefined : records => setSelected(records.filter(r => !(r as Row).__leaving))}
                    isRecordSelectable={record => !record.__leaving}
                    sortStatus={sortStatus as DataTableSortStatus<Row>}
                    onSortStatusChange={status => setSortStatus(status as DataTableSortStatus<TopLevelServerType>)}
                    records={rows}
                    columns={[
                        {
                            accessor: 'Name',
                            sortable: true,
                            render: record => (
                                <Group gap="0.5rem" align="center" wrap="nowrap">
                                    <IconChevronRight
                                        size={16}
                                        className={clsx(classes.chevron, expandedIds.includes(rowKey(record)) && classes.chevronOpen)}
                                    />
                                    {/* Capped so long names truncate instead of widening the table. */}
                                    <Stack gap={0} miw={0} maw={isPhone ? 140 : 280}>
                                        <Text size="sm" fw={600} truncate>{record.Name}</Text>
                                        <RelativeTime date={record.Created} prefix="Created" size="xs" c="dimmed" truncate />
                                    </Stack>
                                    {!record.IsOwner &&
                                        <Tooltip label={`Shared with you by ${displayUserName(record.Owner)}`}>
                                            <Badge variant="light" color="blue" size="sm" style={{ flexShrink: 0 }} visibleFrom="sm">Shared</Badge>
                                        </Tooltip>
                                    }
                                    {record.IsOwner && !!record.SharedWith?.length &&
                                        <Tooltip label={`Shared with ${record.SharedWith.map(displayUserName).join(', ')}`}>
                                            <Badge variant="light" color="gray" size="sm" style={{ flexShrink: 0 }} visibleFrom="sm" leftSection={<IconUsers size={12} />}>
                                                {record.SharedWith.length}
                                            </Badge>
                                        </Tooltip>
                                    }
                                </Group>
                            ),
                        },
                        {
                            accessor: 'GameType',
                            title: 'Game',
                            sortable: true,
                            visibleMediaQuery: theme => `(min-width: ${theme.breakpoints.sm})`,
                            render: record => (
                                <Group gap="0.5rem" wrap="nowrap">
                                    {gameIconFact('1.2rem').get(String(record.GameType))}
                                    <Text size="sm" tt="capitalize">{record.GameType}</Text>
                                </Group>
                            ),
                        },
                        {
                            accessor: 'State',
                            title: 'Status',
                            sortable: true,
                            width: isPhone ? 70 : 140,
                            textAlign: isPhone ? 'center' : undefined,
                            render: record => <StatusBadge state={record.State} message={record.StatusMessage} serverId={record.ID} compact={isPhone} />,
                        },
                        {
                            accessor: 'Players',
                            sortable: true,
                            width: 100,
                            visibleMediaQuery: theme => `(min-width: ${theme.breakpoints.sm})`,
                            render: record => (
                                <Text size="sm" c={record.Live?.players ? undefined : 'dimmed'}>
                                    {record.SupportsPlayers && record.Live?.players
                                        ? <><AnimatedNumber value={record.Live.players.online} /> / {record.Live.players.max}</>
                                        : '—'}
                                </Text>
                            ),
                        },
                        {
                            accessor: 'Resources',
                            sortable: true,
                            width: 170,
                            visibleMediaQuery: theme => `(min-width: ${theme.breakpoints.md})`,
                            render: record => <ResourceCell live={record.Live} />,
                        },
                        {
                            accessor: 'Address',
                            visibleMediaQuery: theme => `(min-width: ${theme.breakpoints.xl})`,
                            render: record => <CopyAddress address={address(record)} size="xs" />,
                        },
                        {
                            accessor: 'actions',
                            title: '',
                            textAlign: 'right',
                            width: 90,
                            render: record => <ServerRowActions server={record} />,
                        },
                    ]}
                    rowExpansion={{
                        allowMultiple: true,
                        expanded: { recordIds: expandedIds, onRecordIdsChange: setExpandedIds },
                        collapseProps: { transitionDuration: 220, transitionTimingFunction: 'ease' },
                        content: ({ record }) => <ServerExpansion server={record} hostIp={systemInfoStore.systemIP} />,
                    }}
                />
                </div>
            </div>
            <BulkActionBar selected={selected} onClear={() => setSelected([])} />
        </>
    );
});

export default ServerTable;
