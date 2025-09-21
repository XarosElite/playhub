import React from "react";
import { hasLength, useForm } from "@mantine/form";
import { Button, Checkbox, Group, NumberInput, PasswordInput, Select, Stack, TextInput } from "@mantine/core";

import { GameType, CreatePalworldType } from "../../../../Api/GameServer";
import { ServerFormProps, validateServerName } from "./shared";


const initialFormValues: CreatePalworldType = {
    environment: {
        SERVER_NAME: "",
        SERVER_DESCRIPTION: "",
        SERVER_PASSWORD: "",
        ADMIN_PASSWORD: "",
        DIFFICULTY: 'Normal',
        EXP_RATE: 0.5,
        PAL_SPAWN: 1.0,
        COMMUNITY: false,
        PLAYERS: 20,
    },
    name: '',
    game_type: GameType.PALWORLD,
    ports: {
        primary_port: 8211,
    }
};

const PalworldForm: React.FC<ServerFormProps<CreatePalworldType>> = ({onClose, onSubmit, submitting}) => {
    const form = useForm<CreatePalworldType>({
        initialValues: initialFormValues,
        validate: {
            name: (val: string) => validateServerName(val),
            environment: {
                SERVER_PASSWORD: (val: string) => hasLength({ min: 3, max: 36 })(val) && "Must be between 3 and 36 characters"
            }
        },
        validateInputOnBlur: true
    });

    return(
        <form onSubmit={form.onSubmit((val) => onSubmit(val))}>
            <Stack gap={'0.6rem'}>
                <TextInput
                    withAsterisk
                    label={'Server name'}
                    {...form.getInputProps('name')}
                />
                <TextInput
                    label={'Server Desciption'}
                    {...form.getInputProps('environment.SERVER_DESCRIPTION')}
                />
                <PasswordInput
                    withAsterisk
                    label="Server Password"
                    placeholder="Password"
                    maxLength={36}
                    {...form.getInputProps('environment.SERVER_PASSWORD')}
                />
                <PasswordInput
                    withAsterisk
                    label="Admin Password"
                    placeholder="Password"
                    maxLength={36}
                    {...form.getInputProps('environment.ADMIN_PASSWORD')}
                />
                <Select
                    maw={''}
                    withCheckIcon={false}
                    allowDeselect={false}
                    label="Difficulty"
                    placeholder="Select a game difficulty"
                    data={[
                        {label: 'Casual', value: 'Casual'},
                        {label: 'Normal', value: 'Normal'},
                        {label: 'Hard', value: 'Hard'},
                    ]}
                    {...form.getInputProps('environment.DIFFICULTY')}
                />
                <Group align="baseline" gap={'0.6rem'} flex={'1'}>
                    <NumberInput
                        miw={'10px'}
                        label="Experience Rate"
                        min={0.1}
                        max={20.0}
                        allowDecimal={true}
                        {...form.getInputProps('environment.EXP_RATE')}
                    />
                    <NumberInput
                        label="Pal Spawn Rate"
                        min={0.5}
                        max={3.0}
                        allowDecimal={true}
                        {...form.getInputProps('environment.PAL_SPAWN')}
                    />
                </Group>
                <Group align="baseline" gap={'0.6rem'} flex={'1'}>
                    <NumberInput
                        miw={'10px'}
                        label="Player count"
                        min={1}
                        max={20}
                        allowDecimal={false}
                        {...form.getInputProps('environment.PLAYERS')}
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
                    label="Allow Server to be Visible to Community"
                    {...form.getInputProps('environment.COMMUNITY')}
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

export default PalworldForm;
