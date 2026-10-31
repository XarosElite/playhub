import React, { useEffect, useState } from 'react';
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
import { notifications } from '@mantine/notifications';

import AppModal from '../../../Shared/Components/AppModal/AppModal';
import { gameIconFact } from '../../../Shared/Util';
import {
  GameServerApi,
  GameCatalogType,
  CreateServerPayloadType,
  EnvironmentFieldSchema,
} from '../../../Api/GameServer';
import { validateServerName } from './Forms/shared';

interface ServerModalProps {
  opened: boolean;
  closeHandler: () => void;
}

const renderSelectOption: SelectProps['renderOption'] = ({ option }) => (
  <Group flex="1" justify="space-between" gap="xs">
    {option.label}
    {gameIconFact('1rem').get(option.value)}
  </Group>
);

function formatFieldLabel(key: string): string {
  if (key === 'EULA') return 'EULA';
  if (key === 'PVP') return 'PvP';

  // Replace underscores with spaces, convert camel/snake case
  const spaced = key.replace(/_/g, ' ');
  return spaced
    .split(' ')
    .map(word => {
      if (word.toUpperCase() === 'ID') return 'ID';
      if (word.toUpperCase() === 'IP') return 'IP';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

const ServerModal: React.FC<ServerModalProps> = ({ opened, closeHandler }) => {
  const [games, setGames] = useState<GameCatalogType[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameCatalogType | null>(null);
  const [serverName, setServerName] = useState<string>('');
  const [serverNameError, setServerNameError] = useState<string | null>(null);
  const [primaryPort, setPrimaryPort] = useState<number>(0);
  const [envValues, setEnvValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Fetch supported games list when modal opens
  useEffect(() => {
    if (opened) {
      GameServerApi.getGames()
        .then(catalog => setGames(catalog))
        .catch(err => {
          console.error('Error fetching game catalog:', err);
          notifications.show({
            title: 'Error',
            message: 'Failed to load game catalog.',
            color: 'red',
          });
        });
    }
  }, [opened]);

  const handleReset = () => {
    setSelectedGame(null);
    setServerName('');
    setServerNameError(null);
    setPrimaryPort(0);
    setEnvValues({});
    setSubmitting(false);
  };

  const handleClose = () => {
    handleReset();
    closeHandler();
  };

  const handleGameSelect = (gameType: string | null) => {
    if (!gameType) {
      setSelectedGame(null);
      return;
    }
    const game = games.find(g => g.game_type === gameType) ?? null;
    setSelectedGame(game);
    setServerName('');
    setServerNameError(null);
    setPrimaryPort(game?.default_port ?? 0);

    // Initialize default environment values from game schema
    const initialEnv: Record<string, any> = {};
    const fields = game?.environment?.fields ?? {};
    Object.entries(fields).forEach(([key, def]) => {
      initialEnv[key] = def.default ?? '';
    });
    setEnvValues(initialEnv);
  };

  const handleEnvChange = (key: string, value: any) => {
    setEnvValues(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSubmit = () => {
    if (!selectedGame) return;

    const nameError = validateServerName(serverName);
    if (nameError) {
      setServerNameError(nameError);
      return;
    }
    setServerNameError(null);

    setSubmitting(true);
    const payload: CreateServerPayloadType = {
      game_type: selectedGame.game_type,
      name: serverName,
      environment: envValues,
      ports: {
        primary_port: Number(primaryPort || selectedGame.default_port),
      },
    };

    GameServerApi.createServer(payload)
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
        notifications.show({
          title: 'Server status',
          message: error?.response?.data?.detail || error?.response?.data?.msg || 'Unable to create game server.',
          color: 'red',
        });
      })
      .finally(() => setSubmitting(false));
  };

  // Function to render an environment input field based on its schema
  const renderField = (fieldName: string, fieldDef: EnvironmentFieldSchema) => {
    const label = formatFieldLabel(fieldName);
    const val = envValues[fieldName] ?? fieldDef.default;

    // Checkbox for boolean
    if (fieldDef.type === 'boolean') {
      return (
        <Checkbox
          key={fieldName}
          mt="xs"
          label={label}
          checked={!!val}
          onChange={e => handleEnvChange(fieldName, e.currentTarget.checked)}
        />
      );
    }

    // Select dropdown for Enum values
    if (fieldDef.enum && fieldDef.enum.length > 0) {
      return (
        <Select
          key={fieldName}
          label={label}
          value={val !== undefined && val !== null ? String(val) : ''}
          data={fieldDef.enum.map(item => ({ value: String(item), label: String(item) }))}
          onChange={v => handleEnvChange(fieldName, v)}
        />
      );
    }

    // Number input for integers / floats
    if (fieldDef.type === 'number' || fieldDef.type === 'integer') {
      return (
        <NumberInput
          key={fieldName}
          label={label}
          value={typeof val === 'number' ? val : (fieldDef.default ?? 0)}
          min={fieldDef.min}
          max={fieldDef.max}
          allowDecimal={fieldDef.type === 'number'}
          onChange={v => handleEnvChange(fieldName, typeof v === 'number' ? v : Number(v))}
        />
      );
    }

    // Password input for secrets/passwords
    if (fieldDef.type === 'password' || fieldName.toLowerCase().includes('password')) {
      return (
        <PasswordInput
          key={fieldName}
          label={label}
          value={String(val ?? '')}
          onChange={e => handleEnvChange(fieldName, e.currentTarget.value)}
        />
      );
    }

    // Standard Text Input
    return (
      <TextInput
        key={fieldName}
        label={label}
        value={String(val ?? '')}
        onChange={e => handleEnvChange(fieldName, e.currentTarget.value)}
      />
    );
  };

  // Derive common vs specific environment fields
  const fields = selectedGame?.environment?.fields ?? {};
  const commonList = selectedGame?.environment?.common_fields ?? selectedGame?.common_fields ?? [];
  const isCommon = (k: string) => commonList.includes(k) || fields[k]?.common === true;

  const allFieldKeys = Object.keys(fields);
  const commonFieldKeys = allFieldKeys.filter(k => isCommon(k));
  const specificFieldKeys = allFieldKeys.filter(k => !isCommon(k));

  return (
    <AppModal opened={opened} closeHandler={handleClose} header="Add Server">
      <Stack gap="1rem">
        <Group mb="1rem">
          <Select
            value={selectedGame?.game_type ?? null}
            onChange={handleGameSelect}
            rightSection={
              selectedGame ? gameIconFact('1rem').get(selectedGame.game_type) : <></>
            }
            rightSectionWidth={30}
            label="Game"
            placeholder="Select a game"
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
              value={serverName}
              error={serverNameError}
              onChange={e => {
                setServerName(e.currentTarget.value);
                setServerNameError(null);
              }}
            />
            <NumberInput
              withAsterisk
              label="Host Port"
              description="Assigned host port for container traffic"
              value={primaryPort}
              min={1024}
              max={65535}
              onChange={v => setPrimaryPort(typeof v === 'number' ? v : Number(v))}
            />

            {/* Customization Settings */}
            <Text size="lg" fw={600} mt="0.5rem">
              Customization
            </Text>

            {/* Common Settings Section */}
            {commonFieldKeys.length > 0 && (
              <Stack gap="0.6rem">
                {commonFieldKeys.map(key => renderField(key, fields[key]))}
              </Stack>
            )}

            {/* Game-Specific Settings Section */}
            {specificFieldKeys.length > 0 && (
              <Stack gap="0.6rem" mt="0.5rem">
                <Text size="sm" fw={600} c="dimmed">
                  Game Specific Parameters
                </Text>
                {specificFieldKeys.map(key => renderField(key, fields[key]))}
              </Stack>
            )}

            <Group gap={8} justify="end" mt="1.5rem">
              {!submitting && (
                <>
                  <Button variant="subtle" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!serverName.trim()}
                  >
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
    </AppModal>
  );
};

export default ServerModal;
