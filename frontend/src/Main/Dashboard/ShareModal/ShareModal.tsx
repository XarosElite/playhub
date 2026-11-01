import React, { useEffect, useRef, useState } from "react";
import { Avatar, Button, ComboboxItem, Group, Loader, MultiSelect, MultiSelectProps, OptionsFilter, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconShare } from "@tabler/icons-react";
import { isAxiosError } from "axios";

import AppModal from "../../../Shared/Components/AppModal/AppModal";
import { GameServerApi, TopLevelServerType } from "../../../Api/GameServer";
import { displayUserName, UsersApi, UserSummaryType } from "../../../Api/Users";

interface ShareModalProps {
    // The server being shared; the modal is open while this is set.
    server: TopLevelServerType | null;
    onClose: () => void;
    onSaved: () => void;
}

const UserLabel: React.FC<{ user: UserSummaryType }> = ({ user }) => (
    <Group gap="sm" wrap="nowrap">
        <Avatar src={user.picture} radius="xl" size="sm" color="green">
            {displayUserName(user).charAt(0).toUpperCase()}
        </Avatar>
        <div style={{ minWidth: 0 }}>
            <Text size="sm" truncate>{displayUserName(user)}</Text>
            {user.name && user.email && <Text size="xs" c="dimmed" truncate>{user.email}</Text>}
        </div>
    </Group>
);

const ShareModal: React.FC<ShareModalProps> = ({ server, onClose, onSaved }) => {
    const [users, setUsers] = useState<UserSummaryType[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [saving, setSaving] = useState<boolean>(false);

    // Read through a ref so a new onClose from the parent doesn't re-trigger loading.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Load everyone who could be shared with, plus who already is.
    useEffect(() => {
        if (!server) return;
        setLoading(true);
        Promise.all([UsersApi.list(), GameServerApi.getShares(server.ID)])
            .then(([allUsers, shared]) => {
                setUsers(allUsers);
                setSelected(shared.map(u => u.uid));
            })
            .catch(() => {
                notifications.show({ title: 'Sharing', message: 'Unable to load users.', color: 'red' });
                onCloseRef.current();
            })
            .finally(() => setLoading(false));
    }, [server]);

    const usersById = new Map(users.map(u => [u.uid, u]));

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
        if (!server) return;
        setSaving(true);
        GameServerApi.setShares(server.ID, selected)
            .then(shared => {
                notifications.show({
                    title: 'Sharing',
                    message: shared.length
                        ? `${server.Name} is shared with ${shared.length} ${shared.length === 1 ? 'person' : 'people'}.`
                        : `${server.Name} is no longer shared.`,
                    color: 'green',
                });
                onSaved();
                onClose();
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
        <AppModal opened={server !== null} closeHandler={onClose} header={server ? `Share ${server.Name}` : 'Share'}>
            <Stack gap="md">
                <Text size="sm" c="dimmed">
                    People you share with can see this server on their dashboard, start, stop and restart it,
                    and use its terminal. Only you can delete it or change who it's shared with.
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

                <Group gap={8} justify="end" mt="sm">
                    <Button variant="subtle" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        loading={saving}
                        disabled={loading || users.length === 0}
                        rightSection={<IconShare size={16} />}
                    >
                        Save
                    </Button>
                </Group>
            </Stack>
        </AppModal>
    );
};

export default ShareModal;
