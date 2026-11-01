import { Provider } from 'mobx-react';
import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

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

import './App.css'

const theme = createTheme({
  primaryColor: 'green',
  primaryShade: 7
});

function App() {
  return (
    <MantineProvider defaultColorScheme='dark' theme={theme}>
      <Notifications />
      <ModalsProvider>
        <Provider systemInfo={systemInfoStore} auth={authStore}>
          <BrowserRouter>
            <Routes>
              <Route path='/login' element={<Login/>}></Route>
              <Route path='/*' element={<RequireAuth><Main/></RequireAuth>}>
              </Route>
              <Route path="*" element={<NotFound/>} />
            </Routes>
          </BrowserRouter>
        </Provider>
      </ModalsProvider>
    </MantineProvider>
  )
}

export default App
