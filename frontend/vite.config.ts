import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser tests (e2e/, run with PLAYHUB_E2E=1) swap Firebase for a fake sign-in.
const e2eAliases = process.env.PLAYHUB_E2E === '1'
  ? [
      { find: /^.*\/Auth\/firebase$/, replacement: fileURLToPath(new URL('./e2e/fakes/firebase.ts', import.meta.url)) },
      { find: /^firebase\/auth$/, replacement: fileURLToPath(new URL('./e2e/fakes/firebase-auth.ts', import.meta.url)) },
    ]
  : []

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: e2eAliases },
  server: {
    port: 4201,
    proxy: {
      "/api": {
        target: 'http://api:8000',
        ws: true
      }
    }
  }
})
