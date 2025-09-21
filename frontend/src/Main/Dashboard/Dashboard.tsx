import { Stack, Title } from "@mantine/core";

import SystemInfo from "./SystemInfo";
import ServerTable from "./ServerTable";

const Dashboard = () => {
    return(
        <Stack gap={64}>
            <SystemInfo/>
            <Stack>
                <Title order={2}>Servers</Title>
                <ServerTable/>
            </Stack>
        </Stack>
    )
};

export default Dashboard;
