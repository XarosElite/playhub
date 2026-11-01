import React, { useEffect, useState } from "react";
import { Avatar, Button, ComboboxItem, Group, Loader, MultiSelect, MultiSelectProps, OptionsFilter, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconShare } from "@tabler/icons-react";
import { isAxiosError } from "axios";

import { GameServerApi, TopLevelServerType } from "../../Api/GameServer";
import { displayUserName, UsersApi, UserSummaryType } from "../../Api/Users";

interface SharePanelProps {
    server: TopLevelServerType;
    // Called after a successful save (e.g. to close a modal).
    onSaved?: () => void;
    // Shows a Cancel button when provided.
    onCancel?: () => void;
}

export const UserLabel: React.FC<{ user: UserSummaryType; size?: 'xs' | 'sm' | 'md' }> = ({ user, size = 'sm' }) => (
    <Group gap="sm" wrap="nowrap">
        <Avatar src={user.picture} radius="xl" size={size} color="green">
            {displayUserName(user).charAt(0).toUpperCase()}
        </Avatar>
        <div style={{ minWidth: 0 }}>
            <Text size="sm" truncate>{displayUserName(user)}</Text>
            {user.name && user.email && <Text size="xs" c="dimmed" truncate>{user.email}</Text>}
        </div>
    </Group>
);

/** Pick who a server is shared with. Owner only. */
const SharePanel: React.FC<SharePanelProps> = ({ server, onSaved, onCancel }) => {
    const [users, setUsers] = useState<UserSummaryType[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [saved, setSaved] = useState<string[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [saving, setSaving] = useState<boolean>(false);

    // Load everyone who could be shared with, plus who already is.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([UsersApi.list(), GameServerApi.getShares(server.ID)])
            .then(([allUsers, shared]) => {
                if (cancelled) return;
                setUsers(allUsers);
                setSelected(shared.map(u => u.uid));
                setSaved(shared.map(u => u.uid));
            })
            .catch(() => notifications.show({ title: 'Sharing', message: 'Unable to load users.', color: 'red' }))
            .finally(() => !cancelled && setLoading(false));
        return () => { cancelled = true; };
    }, [server.ID]);

    const usersById = new Map(users.map(u => [u.uid, u]));
    const dirty = selected.length !== saved.length || selected.some(uid => !saved.includes(uid));

    // Match on email as well as name.
    const filter: OptionsFilter = ({ options, search }) => {
        const query = search.trim().toLowerCase();
        return (options as ComboboxItem[]).filter(option => {
            const user = usersById.get(option.value);
            return [option.label, user?.email].some(text => text?.toLowerCase().includes(query));
        });
    };

    const renderOption: MultiSelectProps['renderOption'] = ({ option }) => {
        const user = usersById.get(option.value);
        return user ? <UserLabel user={user} /> : option.label;
    };

    const handleSave = () => {
        setSaving(true);
        GameServerApi.setShares(server.ID, selected)
            .then(shared => {
                setSaved(shared.map(u => u.uid));
                notifications.show({
                    title: 'Sharing',
                    message: shared.length
                        ? `${server.Name} is shared with ${shared.length} ${shared.length === 1 ? 'person' : 'people'}.`
                        : `${server.Name} is no longer shared.`,
                    color: 'green',
                });
                onSaved?.();
            })
            .catch(error => {
                const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
                notifications.show({
                    title: 'Sharing',
                    message: typeof detail === 'string' ? detail : 'Unable to update sharing.',
                    color: 'red',
                });
            })
            .finally(() => setSaving(false));
    };

    return (
        <Stack gap="md">
            <Text size="sm" c="dimmed">
                People you share with see this server on their dashboard and can start, stop and restart it,
                change its settings, and use its console. Only you can delete it or change who it's shared with.
            </Text>

            {loading ? (
                <Group justify="center" py="md"><Loader size="sm" /></Group>
            ) : users.length === 0 ? (
                <Text size="sm">
                    Nobody else has signed in to PlayHub yet. People appear here after their first sign-in.
                </Text>
            ) : (
                <MultiSelect
                    label="Shared with"
                    placeholder={selected.length ? undefined : 'Search people'}
                    data={users.map(u => ({ value: u.uid, label: displayUserName(u) }))}
                    value={selected}
                    onChange={setSelected}
                    renderOption={renderOption}
                    filter={filter}
                    hidePickedOptions
                    searchable
                    clearable
                    nothingFoundMessage="No one matches"
                    comboboxProps={{ withinPortal: true }}
                />
            )}

            <Group gap={8} justify="end">
                {onCancel && (
                    <Button variant="subtle" onClick={onCancel} disabled={saving}>
                        Cancel
                    </Button>
                )}
                <Button
                    onClick={handleSave}
                    loading={saving}
                    disabled={loading || users.length === 0 || !dirty}
                    rightSection={<IconShare size={16} />}
                >
                    Save
                </Button>
            </Group>
        </Stack>
    );
};

export default SharePanel;
