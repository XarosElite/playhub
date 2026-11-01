import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  Select,
  SelectProps,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { FormErrors, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { isAxiosError } from 'axios';

import AppModal from '../../../Shared/Components/AppModal/AppModal';
import { gameIconFact } from '../../../Shared/Util';
import {
  GameServerApi,
  GameCatalogType,
  CreateServerValidationError,
  EnvironmentFieldSchema,
  EnvironmentValue,
} from '../../../Api/GameServer';
import { validateServerName } from './Forms/shared';

interface ServerModalProps {
  opened: boolean;
  closeHandler: () => void;
}

interface ServerFormValues {
  name: string;
  environment: Record<string, EnvironmentValue>;
}

type FieldSchemas = Record<string, EnvironmentFieldSchema>;

const envPath = (fieldName: string) => `environment.${fieldName}`;

const renderSelectOption: SelectProps['renderOption'] = ({ option }) => (
  <Group flex="1" justify="space-between" gap="xs">
    {option.label}
    {gameIconFact('1rem').get(option.value)}
  </Group>
);

function allFields(game: GameCatalogType | null): FieldSchemas {
  return game ? { ...game.common_fields, ...game.fields } : {};
}

function initialEnvironment(fields: FieldSchemas): Record<string, EnvironmentValue> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, def]) => [key, def.default ?? (def.type === 'boolean' ? false : '')])
  );
}

function isEmpty(value: EnvironmentValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Mirrors the backend rules in api/app/internal/config.py so users get inline
 * errors before submitting. The backend remains the source of truth.
 */
function validateEnvironment(values: ServerFormValues, fields: FieldSchemas): FormErrors {
  const errors: FormErrors = {};
  for (const [key, def] of Object.entries(fields)) {
    const value = values.environment[key];
    if (isEmpty(value)) {
      // The backend falls back to the default, so only a required field with no default is an error.
      if (def.required && def.default == null) errors[envPath(key)] = 'Required';
      continue;
    }
    if (def.type === 'integer' || def.type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) errors[envPath(key)] = 'Must be a number';
      else if (def.min !== undefined && num < def.min) errors[envPath(key)] = `Must be at least ${def.min}`;
      else if (def.max !== undefined && num > def.max) errors[envPath(key)] = `Must be at most ${def.max}`;
    }
  }
  return errors;
}

const ServerModal: React.FC<ServerModalProps> = ({ opened, closeHandler }) => {
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
      const nameError = validateServerName(values.name);
      return {
        ...(nameError ? { name: nameError } : {}),
        ...validateEnvironment(values, fieldsRef.current),
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
    // Host port is automatically assigned by backend (starting from 10000)
    GameServerApi.createServer({
      game_type: selectedGame.game_type,
      name: values.name.trim(),
      environment: values.environment,
    })
      .then(success => {
        if (success) {
          notifications.show({
            title: 'Server status',
            message: 'Game server created successfully.',
            color: 'green',
          });
          handleClose();
        } else {
          notifications.show({
            title: 'Server status',
            message: 'Unable to create game server.',
            color: 'red',
          });
        }
      })
      .catch(error => {
        console.error('Error creating server:', error);
        const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
        let message = 'Unable to create game server.';

        if (detail && typeof detail === 'object' && 'fields' in detail) {
          // Per-field validation errors from the backend: show them inline.
          const { msg, fields } = detail as CreateServerValidationError;
          form.setErrors(
            Object.fromEntries(Object.entries(fields).map(([key, err]) => [envPath(key), err]))
          );
          message = msg;
        } else if (typeof detail === 'string') {
          message = detail;
        }

        notifications.show({ title: 'Server status', message, color: 'red' });
      })
      .finally(() => setSubmitting(false));
  };

  // Render an environment input field based on its schema
  const renderField = (fieldName: string, def: EnvironmentFieldSchema) => {
    const path = envPath(fieldName);
    const common = {
      label: def.label,
      description: def.description,
      withAsterisk: def.required,
    };

    if (def.type === 'boolean') {
      return <Checkbox key={fieldName} {...common} mt="xs" {...form.getInputProps(path, { type: 'checkbox' })} />;
    }

    if (def.enum && def.enum.length > 0) {
      const inputProps = form.getInputProps(path);
      return (
        <Select
          key={fieldName}
          {...common}
          {...inputProps}
          value={isEmpty(inputProps.value) ? null : String(inputProps.value)}
          onChange={v => form.setFieldValue(path, v ?? '')}
          placeholder={def.placeholder}
          allowDeselect={false}
          data={def.enum.map(item => ({ value: String(item), label: String(item) }))}
        />
      );
    }

    if (def.type === 'number' || def.type === 'integer') {
      return (
        <NumberInput
          key={fieldName}
          {...common}
          {...form.getInputProps(path)}
          placeholder={def.placeholder ?? (def.default != null ? `Default: ${def.default}` : undefined)}
          min={def.min}
          max={def.max}
          allowDecimal={def.type === 'number'}
        />
      );
    }

    if (def.type === 'password') {
      return <PasswordInput key={fieldName} {...common} {...form.getInputProps(path)} placeholder={def.placeholder} />;
    }

    return <TextInput key={fieldName} {...common} {...form.getInputProps(path)} placeholder={def.placeholder} />;
  };

  const commonFields = Object.entries(selectedGame?.common_fields ?? {});
  const gameFields = Object.entries(selectedGame?.fields ?? {});

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

              {commonFields.length > 0 && (
                <Stack gap="0.6rem">
                  <Text size="sm" fw={600} c="dimmed">
                    Common Settings
                  </Text>
                  {commonFields.map(([key, def]) => renderField(key, def))}
                </Stack>
              )}

              {gameFields.length > 0 && (
                <Stack gap="0.6rem" mt="0.5rem">
                  <Text size="sm" fw={600} c="dimmed">
                    Game Specific Parameters
                  </Text>
                  {gameFields.map(([key, def]) => renderField(key, def))}
                </Stack>
              )}

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
                    Creating your game server...
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
