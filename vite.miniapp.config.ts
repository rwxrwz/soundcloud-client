import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* The Mini App is built apart from the player on purpose.
 *
 * electron-vite's three bundles are main, preload and renderer, and this is
 * none of them: it runs in a webview on somebody's phone, served over a
 * tunnel by the main process. Sharing the renderer's config would drag in
 * its aliases, its Electron-flavoured globals and its whole dependency
 * graph, for a page that must stay small enough to open over mobile data.
 *
 * Output lands in out/miniapp, which miniapp.ts serves and electron-builder
 * ships along with the rest of out/. */
export default defineConfig({
  root: resolve('miniapp'),
  // Served from the tunnel root, but relative URLs keep it portable.
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve('out/miniapp'),
    emptyOutDir: true,
    target: 'es2020',
    // One file each: a phone on mobile data opens one page, not eleven.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
