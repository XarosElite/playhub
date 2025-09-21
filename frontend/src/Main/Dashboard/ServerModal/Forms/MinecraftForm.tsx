import React from "react";
import { useForm } from "@mantine/form";
import { Button, Checkbox, Group, NumberInput, Select, Stack, TextInput } from "@mantine/core";

import { GameType, CreateMinecraftType } from "../../../../Api/GameServer";
import { ServerFormProps, validateServerName } from "./shared";

const initialFormValues: CreateMinecraftType = {
    environment: {
        EULA: true,
        MODE: 'survival',
        SEED: "",
        PVP: true,
        HARDCORE: false,
        ENABLE_COMMAND_BLOCK: false,
        MAX_PLAYERS: 20
    },
    name: '',
    game_type: GameType.MINECRAFT,
    ports: {
        primary_port: 25565
    }
};

const MinecraftForm: React.FC<ServerFormProps<CreateMinecraftType>> = ({onClose, onSubmit, submitting}) => {
    const form = useForm<CreateMinecraftType>({
        initialValues: initialFormValues,
        validate: {
            name: (val: string) => validateServerName(val)
        },
        validateInputOnBlur: true
    });

    return(
        <form onSubmit={form.onSubmit((val) => onSubmit(val))}>
            <Stack gap={'0.6rem'}>
                <Select
                    maw={''}
                    withCheckIcon={false}
                    allowDeselect={false}
                    label="Type"
                    placeholder="Select a game type"
                    data={[
                        {label: 'Survival', value: 'survival'},
                        {label: 'Creative', value: 'creative'},
                        {label: 'Adventure', value: 'adventure'},
                        {label: 'Spectator', value: 'spectator'}
                    ]}
                    {...form.getInputProps('environment.MODE')}
                />
                <TextInput
                    withAsterisk
                    label={'Server name'}
                    {...form.getInputProps('name')}
                />
                <TextInput
                    label={'Seed'}
                    {...form.getInputProps('environment.SEED')}
                />
                <Group align="baseline" gap={'0.6rem'} flex={'1'}>
                    <NumberInput
                        miw={'10px'}
                        label="Player count"
                        min={1}
                        max={20}
                        allowDecimal={false}
                        {...form.getInputProps('environment.MAX_PLAYERS')}
                    />
                    <NumberInput
                        label="Port"
                        min={1024}
                        max={65535}
                        allowDecimal={false}
                        {...form.getInputProps('ports.primary_port')}
                    />
                </Group>
                <Checkbox
                    mt={"1rem"}
                    label="Enable PvP"
                    {...form.getInputProps('environment.PVP')}
                />
                <Checkbox
                    mt={"1rem"}
                    label="Enable Hardcore"
                    {...form.getInputProps('environment.HARDCORE')}
                />
                <Checkbox
                    mt={"1rem"}
                    label="Enable Command Block"
                    {...form.getInputProps('environment.ENABLE_COMMAND_BLOCK')}
                />
            </Stack>
            <Group gap={8} justify='end' mt={'2rem'}>
                {!submitting &&
                <>
                    <Button variant={'subtle'} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={!form.isValid() || submitting}>
                        Submit
                    </Button>
                </>
                }
            </Group>
        </form>
    );
}

export default MinecraftForm;
