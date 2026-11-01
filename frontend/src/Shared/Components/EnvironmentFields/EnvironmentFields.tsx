import React from 'react';
import { Checkbox, NumberInput, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { UseFormReturnType } from '@mantine/form';
import { motion } from 'motion/react';

import { EnvironmentFieldSchema, GameCatalogType } from '../../../Api/GameServer';
import { fadeUp, stagger } from '../../motion';
import { EnvironmentValues, envPath, isEmpty } from './environment';

interface EnvironmentFieldsProps {
  game: GameCatalogType;
  // Any form whose values include `environment`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturnType<any>;
  disabled?: boolean;
}

/**
 * Renders a game's settings (common + game-specific) from its games.yaml
 * schema. Fields stagger in when the game changes.
 */
const EnvironmentFields: React.FC<EnvironmentFieldsProps> = ({ game, form, disabled }) => {
  const renderField = (fieldName: string, def: EnvironmentFieldSchema) => {
    const path = envPath(fieldName);
    const common = {
      label: def.label,
      description: def.description,
      withAsterisk: def.required,
      disabled,
    };

    if (def.type === 'boolean') {
      // Checkbox has no withAsterisk; mark required ones in the label instead.
      const { withAsterisk, ...checkboxProps } = common;
      return (
        <Checkbox
          {...checkboxProps}
          label={withAsterisk ? <>{def.label} <span style={{ color: 'var(--mantine-color-error)' }}>*</span></> : def.label}
          mt="xs"
          {...form.getInputProps(path, { type: 'checkbox' })}
        />
      );
    }

    if (def.enum && def.enum.length > 0) {
      const inputProps = form.getInputProps(path);
      return (
        <Select
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
      return <PasswordInput {...common} {...form.getInputProps(path)} placeholder={def.placeholder} />;
    }

    return <TextInput {...common} {...form.getInputProps(path)} placeholder={def.placeholder} />;
  };

  const section = (title: string, fields: Record<string, EnvironmentFieldSchema>) => {
    const entries = Object.entries(fields);
    if (entries.length === 0) return null;
    return (
      <Stack gap="0.6rem">
        <motion.div variants={fadeUp}>
          <Text size="sm" fw={600} c="dimmed">{title}</Text>
        </motion.div>
        {entries.map(([key, def]) => (
          <motion.div key={key} variants={fadeUp}>{renderField(key, def)}</motion.div>
        ))}
      </Stack>
    );
  };

  return (
    // Keyed by game so switching games re-runs the stagger.
    <motion.div key={game.game_type} variants={stagger(0.035)} initial="hidden" animate="visible">
      <Stack gap="md">
        {section('Common Settings', game.common_fields)}
        {section('Game Specific Parameters', game.fields)}
      </Stack>
    </motion.div>
  );
};

export type { EnvironmentValues };
export default EnvironmentFields;
