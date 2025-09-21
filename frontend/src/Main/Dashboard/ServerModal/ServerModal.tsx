import React, { useState } from 'react';
import { Button, Group, Loader, Select, SelectProps, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import AppModal from '../../../Shared/Components/AppModal/AppModal';
import { gameIconFact } from '../../../Shared/Util';
import { GameServerApi, GameType, CreateServerType } from '../../../Api/GameServer';
import MinecraftForm from './Forms/MinecraftForm';
import { AxiosError } from 'axios';
import { GenericResponse } from '../../../Api/Share';
import PalworldForm from './Forms/PalworldForm';


interface ServerModalProps {
    opened: boolean;
    closeHandler: () => void;
}


const renderSelectOption: SelectProps['renderOption'] = ({ option }) => (
    <Group flex="1" justify='space-between' gap="xs">
        {option.label}
        {gameIconFact('1rem').get(option.value)}
    </Group>
);

const ServerModal: React.FC<ServerModalProps> = ({opened, closeHandler}) => {

    // Game type we are configuring
    const [gameType, setGameType] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState<boolean>(false);

    const handleClose = () => {
        setGameType(null);
        closeHandler();
    }

    const handleGameChange = (value: string | null) => {
        if (value) setGameType(value);
    }

    /**
     * Handles the form submission. Displays notifications based on result. Closes the modal if all is well.
     * @param formValues server parameters.
     */
    const handleSubmit = (formValues: CreateServerType) => {
        setSubmitting(true);
        GameServerApi.createServer(formValues).then(success => {
            if (success) {
                notifications.show({title: 'Server status', message: 'Game server created successfully.', position: 'top-right', color: 'green'});
                handleClose();
            } else {
                notifications.show({title: 'Server status', message: 'Unable to create game server.', position: 'top-right', color: 'red'});
            }
        }).catch((error: AxiosError<GenericResponse>) => {
            notifications.show({title: 'Server status', message: error?.response?.data.msg || 'Unable to create game server.', position: 'top-right', color: 'red'});
        }).finally(() => setSubmitting(false));
    }

    return (
        <AppModal
            opened={opened}
            closeHandler={handleClose}
            header='Add Server'
        >
            <>
                <Group mb={'2rem'}>
                    <Select
                        value={String(gameType)}
                        onChange={handleGameChange}
                        rightSection={gameType ? gameIconFact('1rem').get(String(gameType)) : <></>}
                        rightSectionWidth={30}
                        label="Game"
                        placeholder="Select a game"
                        data={[
                            {value: String(GameType.MINECRAFT), label: 'Minecraft'},
                            {value: String(GameType.PALWORLD), label: 'Palworld'}
                        ]}
                        renderOption={renderSelectOption}
                    />
                </Group>
                {gameType && <Text size='xl' mb={'.25rem'}>Customization</Text>}
                {(() => {
                    switch (String(gameType)) {
                    case String(GameType.MINECRAFT):
                        return <MinecraftForm onClose={handleClose} onSubmit={handleSubmit} submitting={submitting}/>;
                    case String(GameType.PALWORLD):
                        return <PalworldForm onClose={handleClose} onSubmit={handleSubmit} submitting={submitting}/>;
                    default:
                        return (
                            <Group gap={8} justify='end'>
                                <Button variant={'subtle'} onClick={handleClose}>
                                    Cancel
                                </Button>
                            </Group>
                        )
                    }
                })()}
                {submitting &&
                    <Group justify='flex-end'>
                        <Text size='sm' fw={600}>
                            Creating your game server...
                        </Text>
                        <Loader color='green' />
                    </Group>
                }
            </>
        </AppModal>
    );
}

export default ServerModal;
