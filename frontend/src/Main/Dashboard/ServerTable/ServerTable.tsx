import { useContext, useEffect, useState } from "react";
import { Badge, Button, Group, Loader, Stack, Switch, Text, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { useDisclosure } from "@mantine/hooks";
import { IconRestore, IconServer, IconTrash } from "@tabler/icons-react";
import { DataTable } from 'mantine-datatable';
import { format } from "date-fns";

import { GameServerApi, ServerActionType, TopLevelServerType } from "../../../Api/GameServer";
import { SystemInfoContext } from "../../../Store/SystemInfoStore";
import { gameIconFact } from "../../../Shared/Util";
import ServerModal from "../ServerModal";

import classes from './ServerTable.module.scss';


const ServerTable = () => {
    const systemInfoStore = useContext(SystemInfoContext);
    const [servers, setServers] = useState<TopLevelServerType[]>([]);
    const [addGameOpened, addGameHandlers] = useDisclosure(false);
    const [initialLoad, setInitialLoad] = useState<boolean>(true);
    const [modifyingServers, setModifyingServers] = useState<string[]>([]);

    useEffect(() => {
        fetchServers();

        const interval = setInterval(() => {
            fetchServers();
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const fetchServers = () => {
        GameServerApi.getServers().then(res => {
            setServers(res.msg);
            setInitialLoad(false);
        });
    }

    const doServerAction = (server: TopLevelServerType, action: ServerActionType) => {
        setModifyingServers(servers => [...servers, server.ID]);

        GameServerApi.makeServerAction(server.ID, action).then((success) => {
            if (!success) {
                notifications.show({title: 'Server status', message: `Server update failed for ${server.Name}.`, position: 'top-right', color: 'red'});
            }
            fetchServers();
        })
        .catch(() => {
            notifications.show({title: 'Server status', message: `Server update failed for ${server.Name}.`, position: 'top-right', color: 'red'});
        }).finally(() => {
            setModifyingServers(servers => servers.filter(s =>  s !== server.ID))
        });
    }

    const deleteServer = (server: TopLevelServerType) => {
        const {Name, ID} = server;
        setModifyingServers(servers => [...servers, ID]);

        GameServerApi.deleteServer(ID).then(() => {
            notifications.show({title: 'Server status', message: `Deleted ${Name}.`, position: 'top-right', color: 'green'});
            setServers(servers => servers.filter(servers => servers.ID !== ID));
        }).catch(() => {
            notifications.show({title: 'Server status', message: `Unable to delete ${Name}.`, position: 'top-right', color: 'red'});
        }).finally(() => {
            setModifyingServers(servers => servers.filter(s =>  s !== ID));
        });
    }

    const openDeleteConfirm = (server: TopLevelServerType) => modals.openConfirmModal({
        title: 'Delete server',
        closeOnEscape: false,
        closeOnClickOutside: false,
        labels: { confirm: 'Yes, Delete', cancel: 'No, Don\'t Delete'},
        children: (
            <Text size="sm">
                Are you sure you want to delete {server.Name}? There is no going back.
            </Text>
        ),
        onConfirm: () => deleteServer(server),
    });

    return (
        <>
            <ServerModal closeHandler={addGameHandlers.close} opened={addGameOpened} />
                <Group>
                    <Button
                        onClick={addGameHandlers.open}
                    >
                        Add Server
                    </Button>
                </Group>
                <DataTable
                    height={500}
                    idAccessor={'ID'}
                    noRecordsText="No servers found"
                    fetching={initialLoad}
                    withTableBorder
                    noRecordsIcon={
                        <IconServer size={36} strokeWidth={1.5} />
                    }
                    rowClassName={classes.row}
                    className={classes.table}
                    columns={[
                        {
                            accessor: 'Name',
                            title: 'Name',
                            render: (record) => (
                                <Group gap={'0.5rem'} align="center">
                                    {record.Name}
                                    {modifyingServers.find(s => s === record.ID) &&
                                        <Tooltip label="This server has an action pending" >
                                            <Badge className={classes.pendingActionIndicator} w="0.5rem" color={'yellow.4'}/>
                                        </Tooltip>
                                    }
                                </Group>
                            )
                        },
                        {
                            accessor: 'GameType',
                            title: 'Type',
                            render: (record) => (
                                <Group gap={'0.5rem'}>
                                    {record.GameType}
                                    {gameIconFact('1.2rem').get(String(record.GameType))}
                                </Group>
                            )
                        },
                        {
                            accessor: 'State',
                            render: (record) => (
                                <Badge color={record.State === 'running' ? 'green' : 'red'}>
                                    {record.State === 'running' ? 'Up' : 'Down'}
                                </Badge>
                            )
                        }
                    ]}
                    records={servers}
                    rowExpansion={{
                        content: ({ record }) => {

                            const isRunning = record.State === 'running';
                            const pendingAction = modifyingServers.find(s => s === record.ID);

                            return (
                                <>
                                    <Group className={classes.details} py="md" px="sm" gap={48} align="top">
                                    <Stack>
                                        <Group gap={'0.25rem'} align="top">
                                            <Text fw={600} size="md">Created at:</Text>
                                            <Text size="md">{format(record.Created, 'MM/dd/yy h:mm:ss a')}</Text>
                                        </Group>
                                        <Text size="md">{systemInfoStore.systemIP}:{record.Ports.primary_port}</Text>
                                    </Stack>
                                    
                                    {pendingAction ?
                                        <Group gap={'1rem'}>
                                            <Text size='md'>
                                                Server is being updated
                                            </Text>
                                            <Loader size='sm'/>
                                        </Group> :
                                        <>
                                            <Group>
                                                <Button
                                                    rightSection={<IconRestore/>}
                                                    variant="outline"
                                                    onClick={() => doServerAction(record, ServerActionType.RESTART)}
                                                >
                                                    Restart
                                                </Button>
                                                <Button
                                                    color='red' variant="outline"
                                                    onClick={() => openDeleteConfirm(record)}
                                                    rightSection={<IconTrash/>}
                                                >
                                                    Delete
                                                </Button>
                                                <Switch
                                                    checked={isRunning}
                                                    size="md"
                                                    label={isRunning ? 'Up' : 'Down'}
                                                    onClick={() => doServerAction(record, isRunning ? ServerActionType.STOP : ServerActionType.START)}/>
                                            </Group>
                                        </>
                                    }
                                </Group>
                                
                                
                                </>
                                
                            )
                        },
                    }}
                />
        </>
    );
}


export default ServerTable;
