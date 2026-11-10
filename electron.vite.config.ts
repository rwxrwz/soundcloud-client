import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

/* The app's own Genius credential, baked in at build time. Taken from
   GENIUS_TOKEN in the environment or in a .env file next to this config -
   .env is gitignored, so the token stays out of the repository.

   An API client token is meant to identify the APPLICATION, so one for the
   player is the right shape - but it ships inside a JS bundle, which anyone
   can unpack. Treat it as public, never as a secret: the rate limit is
   shared by everyone running the app, and if it is ever revoked the feature
   stops for all of them at once. A person who puts their own token in
   settings uses theirs instead.

   Empty in a plain `npm run dev` with no .env, and the code is written for
   that: lyrics simply ask for a token then. */
const geniusToken = () =>
  process.env.GENIUS_TOKEN ?? loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), 'GENIUS').GENIUS_TOKEN ?? ''

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __GENIUS_TOKEN__: JSON.stringify(geniusToken()),
    },
    build: {
      lib: {
        entry: resolve('electron/main.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/preload.ts')
      }
    }
  },
  renderer: {
    root: resolve('src'),
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('src/index.html')
      }
    }
  }
})
