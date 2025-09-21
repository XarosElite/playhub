import { Link, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ActionIcon, AppShell, Burger, Group, Image, NavLink, Tooltip, useMantineColorScheme } from "@mantine/core";
import { IconHome2, IconMoon, IconSettings, IconSun } from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";

import Settings from "./Settings";
import Dashboard from "./Dashboard";

import bannerLight from '/playhub_logo_light.svg';
import bannerDark from '/playhub_logo_dark.svg';

import classes from './Main.module.scss';
import NotFound from "../NotFound";
import { useContext, useEffect } from "react";
import { SystemInfoContext } from "../Store/SystemInfoStore";
  
const navLinks = [
  { id: 'dashboard', icon: IconHome2, label: 'Dashboard', link: '/' },
  { id: 'settings', icon: IconSettings, label: 'Settings', link: '/settings' },
];

const Main = () => {
    // used for controlling panel
    const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
    const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);

    // mark mode related
    const {setColorScheme, colorScheme} = useMantineColorScheme();
    const darkMode = colorScheme === 'dark';

    // for determining current selected tab on load
    const currentPath = useLocation()?.pathname;

    const systemInfoStore = useContext(SystemInfoContext);
    
    // Navbar links
    const links = navLinks.map((item) => (
      <NavLink
        key={item.label}
        active={item.link === currentPath || undefined}
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

    return (
        <AppShell
            header={{ height: 70 }}
            navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !mobileOpened, desktop: !desktopOpened }}}
            padding="md"
        >
        <AppShell.Header>
          <Group h="100%" p='sm'>
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="md" size="md" />
            <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="md" size="md" />
            <Image src={darkMode ? bannerDark : bannerLight} className={classes.logo}/>
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
                aria-label="Settings"
                onClick={() => setColorScheme(darkMode ? 'light' : 'dark')}
              >
                {darkMode ? <IconMoon stroke={1} /> : <IconSun stroke={1} />}
              </ActionIcon>
            </Tooltip>
        </AppShell.Navbar>
        <AppShell.Main>
            <Routes>
              <Route path="/" element={<Dashboard/>} />
              {/* <Route path="server/:serverId" element={<div>server goes here</div>} /> */}
              <Route path='/settings' element={<Settings/>}/>
              <Route path="*" element={<NotFound />} />
            </Routes>
            <Outlet/>
        </AppShell.Main>
      </AppShell>
    )
};

export default Main;
