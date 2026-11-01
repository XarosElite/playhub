import { Link, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { notifications } from "@mantine/notifications";
import { ActionIcon, AppShell, Avatar, Burger, Group, Image, Menu, NavLink, Text, Tooltip, UnstyledButton, useMantineColorScheme } from "@mantine/core";
import { IconChevronDown, IconHome2, IconLogout, IconMoon, IconSettings, IconSun } from "@tabler/icons-react";
import { observer } from "mobx-react";
import { useDisclosure } from "@mantine/hooks";

import Settings from "./Settings";
import Dashboard from "./Dashboard";
import ServerPage from "./Server";

import bannerLight from '/playhub_logo_light.svg';
import bannerDark from '/playhub_logo_dark.svg';

import classes from './Main.module.scss';
import NotFound from "../NotFound";
import { useContext, useEffect } from "react";
import { SystemInfoContext } from "../Store/SystemInfoStore";
import { AuthContext } from "../Store/AuthStore";
import { ServerStoreContext } from "../Store/ServerStore";
import { page } from "../Shared/motion";
import { celebrateAt } from "../Shared/celebrate";
  
const navLinks = [
  { id: 'dashboard', icon: IconHome2, label: 'Dashboard', link: '/' },
  { id: 'settings', icon: IconSettings, label: 'Settings', link: '/settings' },
];

const Main = observer(() => {
    // used for controlling panel
    const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
    const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);

    // mark mode related
    const {setColorScheme, colorScheme} = useMantineColorScheme();
    const darkMode = colorScheme === 'dark';

    // for determining current selected tab on load
    const location = useLocation();
    const currentPath = location.pathname;

    const systemInfoStore = useContext(SystemInfoContext);
    const authStore = useContext(AuthContext);
    const serverStore = useContext(ServerStoreContext);
    const user = authStore.user;
    const displayName = user?.displayName || user?.email || "Account";
    
    // Navbar links
    const links = navLinks.map((item) => (
      <NavLink
        key={item.label}
        active={(item.link === '/' ? currentPath === '/' || currentPath.startsWith('/server/') : item.link === currentPath) || undefined}
        label={item.label}
        leftSection={<item.icon stroke={1.5} />}
        component={Link}
        to={item.link}
        onClick={toggleMobile}
        fw={600}
      />
    ));

    /**
     * Fetches the system info
     */
    useEffect(() => {
      systemInfoStore.fetchSystemInfoPoint();
      systemInfoStore.fetchSystemIp();
      const doFetch = () => systemInfoStore.fetchSystemInfoPoint();
      const intervalId = setInterval(doFetch, 3000);
      return () => clearInterval(intervalId);
    }, [systemInfoStore]);

    /**
     * Live server updates for every page, and a small celebration when a newly
     * created server comes up.
     */
    useEffect(() => {
      const unsubscribe = serverStore.subscribe();
      const stopListening = serverStore.onServerLive(server => {
        notifications.show({ title: `🎉 ${server.Name} is live!`, message: 'Your server is up and ready for players.', color: 'green' });
        // Wait a frame so the badge has re-rendered as "Running".
        requestAnimationFrame(() => celebrateAt(document.querySelector(`[data-status-badge="${CSS.escape(server.ID)}"]`)));
      });
      return () => { stopListening(); unsubscribe(); };
    }, [serverStore]);

    return (
        <AppShell
            header={{ height: 70 }}
            navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !mobileOpened, desktop: !desktopOpened }}}
            padding="md"
        >
        <AppShell.Header>
          <Group h="100%" p='sm' justify="space-between" wrap="nowrap">
            <Group wrap="nowrap">
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="md" size="md" />
              <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="md" size="md" />
              <Image src={darkMode ? bannerDark : bannerLight} className={classes.logo}/>
            </Group>
            <Menu position="bottom-end" shadow="md" width={240}>
              <Menu.Target>
                <UnstyledButton className={classes.userButton} aria-label="Account menu">
                  <Group gap="xs" wrap="nowrap">
                    <Avatar src={user?.photoURL} alt={displayName} radius="xl" size="sm" color="green">
                      {displayName.charAt(0).toUpperCase()}
                    </Avatar>
                    <Text size="sm" fw={600} visibleFrom="sm" truncate maw="12rem">{displayName}</Text>
                    <IconChevronDown size={14} stroke={1.5} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Signed in as</Menu.Label>
                <Text size="sm" px="sm" pb="xs" truncate>{user?.email}</Text>
                <Menu.Divider />
                <Menu.Item leftSection={<IconLogout size={16} stroke={1.5} />} onClick={authStore.signOut}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar pt='lg' className={classes.navbar}>
            <div>
              {links}
            </div>
            <Tooltip label='Toggle color theme'>
              <ActionIcon
                className={classes.themeToggle}
                variant={darkMode ? 'outline' : 'filled'}
                color={darkMode ? 'green' : 'green.6'}
                size="md"
                aria-label="Toggle color theme"
                onClick={() => setColorScheme(darkMode ? 'light' : 'dark')}
              >
                {darkMode ? <IconMoon stroke={1} /> : <IconSun stroke={1} />}
              </ActionIcon>
            </Tooltip>
        </AppShell.Navbar>
        <AppShell.Main>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={location.pathname} variants={page} initial="initial" animate="animate" exit="exit">
                <Routes location={location}>
                  <Route path="/" element={<Dashboard/>} />
                  <Route path="/server/:serverId" element={<ServerPage/>} />
                  <Route path='/settings' element={<Settings/>}/>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </motion.div>
            </AnimatePresence>
        </AppShell.Main>
      </AppShell>
    )
});

export default Main;
