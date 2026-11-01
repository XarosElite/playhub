import { useContext } from "react";
import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { isAxiosError } from "axios";

import { ServerActionType, TopLevelServerType, TRANSITIONAL_STATES } from "../../Api/GameServer";
import { ServerStoreContext } from "../../Store/ServerStore";
import SharePanel from "./SharePanel";

const ACTION_LABEL: Partial<Record<ServerActionType, string>> = {
    [ServerActionType.START]: 'start',
    [ServerActionType.STOP]: 'stop',
    [ServerActionType.RESTART]: 'restart',
};

function errorDetail(error: unknown): string | null {
    const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
    return typeof detail === 'string' ? detail : null;
}

export const isRunning = (server: TopLevelServerType) => server.State === 'running';
export const isBusy = (server: TopLevelServerType) => TRANSITIONAL_STATES.has(server.State);

/**
 * Server actions shared by the dashboard table and the server page, with
 * consistent confirmations and notifications.
 */
export function useServerActions() {
    const serverStore = useContext(ServerStoreContext);

    const run = (server: TopLevelServerType, action: ServerActionType, quiet = false): Promise<boolean> =>
        serverStore.runAction(server, action)
            .then(success => {
                if (!success && !quiet) {
                    notifications.show({
                        title: server.Name,
                        message: `Couldn't ${ACTION_LABEL[action]} the server. Hover its status for details.`,
                        color: 'red',
                    });
                }
                return success;
            })
            .catch(error => {
                if (!quiet) {
                    notifications.show({
                        title: server.Name,
                        message: errorDetail(error) ?? `Couldn't ${ACTION_LABEL[action]} the server.`,
                        color: 'red',
                    });
                }
                return false;
            });

    const start = (server: TopLevelServerType) => run(server, ServerActionType.START);
    const stop = (server: TopLevelServerType) => run(server, ServerActionType.STOP);
    const restart = (server: TopLevelServerType) => run(server, ServerActionType.RESTART);
    const toggle = (server: TopLevelServerType) => (isRunning(server) ? stop(server) : start(server));

    const deleteNow = (server: TopLevelServerType) =>
        serverStore.deleteServer(server)
            .then(() => notifications.show({ title: server.Name, message: 'Server deleted.', color: 'green' }))
            .catch(error => notifications.show({
                title: server.Name,
                message: errorDetail(error) ?? 'Unable to delete the server.',
                color: 'red',
            }));

    const confirmDelete = (server: TopLevelServerType, onDeleted?: () => void) => modals.openConfirmModal({
        title: `Delete ${server.Name}?`,
        centered: true,
        labels: { confirm: 'Delete server', cancel: 'Keep it' },
        confirmProps: { color: 'red' },
        children: (
            <Text size="sm">
                This removes the server and its world data for you and everyone it's shared with.
                There is no going back.
            </Text>
        ),
        onConfirm: () => deleteNow(server).then(() => onDeleted?.()),
    });

    const openShare = (server: TopLevelServerType) => {
        const id = `share-${server.ID}`;
        modals.open({
            modalId: id,
            title: `Share ${server.Name}`,
            centered: true,
            children: (
                <SharePanel
                    server={server}
                    onSaved={() => { modals.close(id); serverStore.refresh(); }}
                    onCancel={() => modals.close(id)}
                />
            ),
        });
    };

    /** Runs an action on several servers; skips ones it doesn't apply to. */
    const bulk = async (servers: TopLevelServerType[], action: 'start' | 'stop' | 'restart') => {
        const applicable = servers.filter(s => !isBusy(s) && (action === 'start' ? !isRunning(s) : isRunning(s)));
        if (applicable.length === 0) {
            notifications.show({ message: `None of the selected servers can be ${action === 'stop' ? 'stopped' : action + 'ed'} right now.`, color: 'yellow' });
            return;
        }
        const type = { start: ServerActionType.START, stop: ServerActionType.STOP, restart: ServerActionType.RESTART }[action];
        const results = await Promise.all(applicable.map(s => run(s, type, true)));
        const failed = results.filter(ok => !ok).length;
        notifications.show({
            title: 'Bulk action',
            message: failed
                ? `${applicable.length - failed} of ${applicable.length} servers ${action === 'stop' ? 'stopped' : action + 'ed'}; ${failed} failed.`
                : `${applicable.length} server${applicable.length === 1 ? '' : 's'} ${action === 'stop' ? 'stopped' : action + 'ed'}.`,
            color: failed ? 'yellow' : 'green',
        });
    };

    const confirmBulkDelete = (servers: TopLevelServerType[], onDone?: () => void) => {
        const owned = servers.filter(s => s.IsOwner);
        const skipped = servers.length - owned.length;
        if (owned.length === 0) {
            notifications.show({ message: 'Only a server\'s owner can delete it.', color: 'yellow' });
            return;
        }
        modals.openConfirmModal({
            title: `Delete ${owned.length} server${owned.length === 1 ? '' : 's'}?`,
            centered: true,
            labels: { confirm: 'Delete', cancel: 'Keep them' },
            confirmProps: { color: 'red' },
            children: (
                <Text size="sm">
                    {owned.map(s => s.Name).join(', ')} and {owned.length === 1 ? 'its' : 'their'} world data will be removed.
                    {skipped > 0 && ` ${skipped} shared server${skipped === 1 ? '' : 's'} will be skipped (only owners can delete).`}
                </Text>
            ),
            onConfirm: () => Promise.all(owned.map(deleteNow)).then(() => onDone?.()),
        });
    };

    return { start, stop, restart, toggle, confirmDelete, openShare, bulk, confirmBulkDelete };
}
