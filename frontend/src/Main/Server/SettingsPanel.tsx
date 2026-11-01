import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconInfoCircle } from "@tabler/icons-react";
import { isAxiosError } from "axios";

import { CreateServerValidationError, GameCatalogType, GameServerApi, TopLevelServerType } from "../../Api/GameServer";
import EnvironmentFields, {
    EnvironmentValues, FieldSchemas, allFields, environmentErrors, initialEnvironment, validateEnvironment,
} from "../../Shared/Components/EnvironmentFields";
import { isBusy } from "./useServerActions";

interface SettingsValues {
    environment: EnvironmentValues;
}

/** Edit a server's game settings after creation. Saving recreates the container. */
const SettingsPanel: React.FC<{ server: TopLevelServerType; onSaved: () => void }> = ({ server, onSaved }) => {
    const [game, setGame] = useState<GameCatalogType | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const fieldsRef = useRef<FieldSchemas>({});
    fieldsRef.current = allFields(game);

    const form = useForm<SettingsValues>({
        initialValues: { environment: {} },
        validate: values => validateEnvironment(values.environment, fieldsRef.current),
    });

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([GameServerApi.getGames(), GameServerApi.getSettings(server.Name)])
            .then(([games, settings]) => {
                if (cancelled) return;
                const match = games.find(g => g.game_type === settings.game_type) ?? null;
                setGame(match);
                const values = { environment: initialEnvironment(allFields(match), settings.environment) };
                form.setInitialValues(values);
                form.setValues(values);
                form.resetDirty(values);
            })
            .catch(() => notifications.show({ title: server.Name, message: 'Unable to load settings.', color: 'red' }))
            .finally(() => !cancelled && setLoading(false));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [server.Name]);

    const save = (values: SettingsValues) => {
        setSaving(true);
        GameServerApi.updateSettings(server.Name, values.environment)
            .then(result => {
                if (result.changed.length === 0) {
                    notifications.show({ title: server.Name, message: 'No changes to apply.', color: 'gray' });
                    return;
                }
                form.resetDirty(values);
                notifications.show({
                    title: server.Name,
                    message: `Applying ${result.changed.join(', ')}. The server restarts with the new settings.`,
                    color: 'green',
                });
                onSaved();
            })
            .catch(error => {
                const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
                if (detail && typeof detail === 'object' && 'fields' in detail) {
                    form.setErrors(environmentErrors((detail as CreateServerValidationError).fields));
                }
                notifications.show({
                    title: server.Name,
                    message: typeof detail === 'string' ? detail : (detail?.msg ?? 'Unable to save settings.'),
                    color: 'red',
                });
            })
            .finally(() => setSaving(false));
    };

    const confirmSave = (values: SettingsValues) => modals.openConfirmModal({
        title: 'Apply new settings?',
        centered: true,
        labels: { confirm: 'Apply and restart', cancel: 'Cancel' },
        children: (
            <Text size="sm">
                {server.Name} will restart with the new settings, which disconnects anyone playing. World data is kept.
            </Text>
        ),
        onConfirm: () => save(values),
    });

    if (loading) return <Group justify="center" py="xl"><Loader size="sm" /></Group>;
    if (!game) return <Alert color="red">This game is no longer in the catalog, so its settings can't be edited.</Alert>;

    const busy = isBusy(server);

    return (
        <form onSubmit={form.onSubmit(confirmSave)}>
            <Stack gap="md" maw={560}>
                <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />}>
                    Changes apply when you save: the server restarts with the new settings and keeps its world.
                </Alert>
                <EnvironmentFields game={game} form={form} disabled={saving || busy} />
                <Group justify="end" gap="xs">
                    <Button variant="subtle" disabled={!form.isDirty() || saving} onClick={() => form.reset()}>
                        Discard changes
                    </Button>
                    <Button type="submit" loading={saving} disabled={!form.isDirty() || busy}>
                        Save settings
                    </Button>
                </Group>
            </Stack>
        </form>
    );
};

export default SettingsPanel;
