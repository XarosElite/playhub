import { Stack, Title } from "@mantine/core";

import SystemInfo from "./SystemInfo";
import ServerTable from "./ServerTable";

import classes from './Dashboard.module.scss';

const Dashboard = () => {
    return(
        <Stack gap="xl" className={classes.dashboard}>
            <SystemInfo/>
            <Stack className={classes.servers}>
                <Title order={2}>Servers</Title>
                <ServerTable/>
            </Stack>
        </Stack>
    )
};

export default Dashboard;
