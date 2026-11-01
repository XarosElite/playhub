import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Group,
  Loader,
  Select,
  SelectProps,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { isAxiosError } from 'axios';

import AppModal from '../../../Shared/Components/AppModal/AppModal';
import { gameIconFact } from '../../../Shared/Util';
import {
  GameServerApi,
  GameCatalogType,
  CreateServerValidationError,
  EnvironmentValue,
} from '../../../Api/GameServer';
import EnvironmentFields, {
  FieldSchemas,
  allFields,
  environmentErrors,
  initialEnvironment,
  validateEnvironment,
} from '../../../Shared/Components/EnvironmentFields';
import { validateServerName } from './Forms/shared';

interface ServerModalProps {
  opened: boolean;
  closeHandler: () => void;
  // Called once the create request is accepted (the server now exists, starting).
  onCreated?: () => void;
}

interface ServerFormValues {
  name: string;
  environment: Record<string, EnvironmentValue>;
}

const renderSelectOption: SelectProps['renderOption'] = ({ option }) => (
  <Group flex="1" justify="space-between" gap="xs">
    {option.label}
    {gameIconFact('1rem').get(option.value)}
  </Group>
);

const ServerModal: React.FC<ServerModalProps> = ({ opened, closeHandler, onCreated }) => {
  const [games, setGames] = useState<GameCatalogType[]>([]);
  const [gamesLoading, setGamesLoading] = useState<boolean>(false);
  const [selectedGame, setSelectedGame] = useState<GameCatalogType | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // The form's validate callback is created once, so it reads the current schema through a ref.
  const fieldsRef = useRef<FieldSchemas>({});
  fieldsRef.current = allFields(selectedGame);

  const form = useForm<ServerFormValues>({
    initialValues: { name: '', environment: {} },
    validate: values => {
      const nameError = validateServerName(values.name.trim());
      return {
        ...(nameError ? { name: nameError } : {}),
        ...validateEnvironment(values.environment, fieldsRef.current),
      };
    },
  });

  // Fetch supported games list when modal opens
  useEffect(() => {
    if (!opened) return;
    setGamesLoading(true);
    GameServerApi.getGames()
      .then(catalog => setGames(catalog))
      .catch(err => {
        console.error('Error fetching game catalog:', err);
        notifications.show({
          title: 'Error',
          message: 'Failed to load game catalog.',
          color: 'red',
        });
      })
      .finally(() => setGamesLoading(false));
  }, [opened]);

  const handleClose = () => {
    setSelectedGame(null);
    setSubmitting(false);
    form.reset();
    closeHandler();
  };

  const handleGameSelect = (gameType: string | null) => {
    const game = games.find(g => g.game_type === gameType) ?? null;
    setSelectedGame(game);
    form.setFieldValue('environment', initialEnvironment(allFields(game)));
    form.clearErrors();
  };

  const handleSubmit = (values: ServerFormValues) => {
    if (!selectedGame) return;

    setSubmitting(true);
    const name = values.name.trim();
    let queued = false;
    // Host port is automatically assigned by backend (starting from 10000).
    // The modal closes as soon as the server is queued; its row shows progress.
    GameServerApi.createServer(
      { game_type: selectedGame.game_type, name, environment: values.environment },
      () => {
        queued = true;
        notifications.show({
          title: 'Creating server',
          message: `${name} is starting up. This can take a few minutes the first time.`,
          color: 'green',
        });
        handleClose();
        onCreated?.();
      },
    )
      .then(success => {
        if (!success) {
          notifications.show({
            title: 'Server status',
            message: `${name} couldn't be created. Check its status for details.`,
            color: 'red',
          });
        }
      })
      .catch(error => {
        console.error('Error creating server:', error);
        if (queued) return;
        const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
        let message = 'Unable to create game server.';

        if (detail && typeof detail === 'object' && 'fields' in detail) {
          // Per-field validation errors from the backend: show them inline.
          const { msg, fields } = detail as CreateServerValidationError;
          form.setErrors(environmentErrors(fields));
          message = msg;
        } else if (typeof detail === 'string') {
          message = detail;
        }

        notifications.show({ title: 'Server status', message, color: 'red' });
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <AppModal opened={opened} closeHandler={handleClose} header="Add Server">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="1rem">
          <Group mb="1rem">
            <Select
              value={selectedGame?.game_type ?? null}
              onChange={handleGameSelect}
              rightSection={
                gamesLoading ? (
                  <Loader size="xs" />
                ) : selectedGame ? (
                  gameIconFact('1rem').get(selectedGame.game_type)
                ) : (
                  <></>
                )
              }
              rightSectionWidth={30}
              label="Game"
              placeholder={gamesLoading ? 'Loading games...' : 'Select a game'}
              disabled={gamesLoading && games.length === 0}
              allowDeselect={false}
              data={games.map(g => ({
                value: g.game_type,
                label: g.game_type.toUpperCase(),
              }))}
              renderOption={renderSelectOption}
            />
          </Group>

          {selectedGame && (
            <>
              {/* Basic Information */}
              <Text size="lg" fw={600}>
                Basic Settings
              </Text>
              <TextInput
                withAsterisk
                label="Server Name"
                placeholder="e.g. my-awesome-server"
                {...form.getInputProps('name')}
              />
              <Text size="xs" c="dimmed">
                Internal Container Port: {selectedGame.internal_port} (Host port automatically assigned starting from 10000)
              </Text>

              {/* Customization Settings */}
              <Text size="lg" fw={600} mt="0.5rem">
                Customization
              </Text>

              <EnvironmentFields game={selectedGame} form={form} />

              <Group gap={8} justify="end" mt="1.5rem">
                {!submitting && (
                  <>
                    <Button variant="subtle" onClick={handleClose}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={!form.values.name.trim()}>
                      Submit
                    </Button>
                  </>
                )}
              </Group>

              {submitting && (
                <Group justify="flex-end" mt="0.5rem">
                  <Text size="sm" fw={600}>
                    Queueing your game server...
                  </Text>
                  <Loader color="green" size="sm" />
                </Group>
              )}
            </>
          )}
        </Stack>
      </form>
    </AppModal>
  );
};

export default ServerModal;
