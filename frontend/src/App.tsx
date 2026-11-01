import { Provider } from 'mobx-react';
import { createTheme, MantineProvider, Modal } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

// keep near top to let component style overrides apply
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import 'mantine-datatable/styles.layer.css';
import '@mantine/notifications/styles.css';

// Custom components
import Main from './Main';
import Login from './Login';
import NotFound from './NotFound';
import RequireAuth from './Auth/RequireAuth';

// Stores
import { systemInfoStore } from './Store/SystemInfoStore';
import { authStore } from './Store/AuthStore';
import { serverStore } from './Store/ServerStore';
import { DURATION, EASE_OUT } from './Shared/motion';

import './App.css'

const theme = createTheme({
  primaryColor: 'green',
  primaryShade: 7,
  components: {
    // Modals pop in rather than appearing instantly.
    Modal: Modal.extend({
      defaultProps: { transitionProps: { transition: 'pop', duration: 200, timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } },
    }),
  },
});

/**
 * Login ↔ app transition: the login card scales away as the dashboard fades
 * in (and the reverse on sign-out).
 */
function AppRoutes() {
  const location = useLocation();
  const area = location.pathname === '/login' ? 'login' : 'app';

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={area}
        initial={{ opacity: 0, scale: area === 'login' ? 1.02 : 0.99 }}
        animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } }}
        exit={{ opacity: 0, scale: area === 'login' ? 0.97 : 1.01, transition: { duration: DURATION.base, ease: 'easeIn' } }}
      >
        <Routes location={location}>
          <Route path='/login' element={<Login/>}></Route>
          <Route path='/*' element={<RequireAuth><Main/></RequireAuth>}>
          </Route>
          <Route path="*" element={<NotFound/>} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
    // reducedMotion="user": animations respect the OS "reduce motion" setting.
    <MotionConfig reducedMotion="user">
    <MantineProvider defaultColorScheme='dark' theme={theme}>
      <Notifications />
      <ModalsProvider>
        <Provider systemInfo={systemInfoStore} auth={authStore} servers={serverStore}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </Provider>
      </ModalsProvider>
    </MantineProvider>
    </MotionConfig>
  )
}

export default App
