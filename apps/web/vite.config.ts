import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Departarr',
        short_name: 'Departarr',
        description: 'Self-hosted flight tracker',
        theme_color: '#05080f',
        background_color: '#05080f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        importScripts: ['push-handler.js'],
        // Let navigations to /api (esp. the OAuth redirect endpoints) hit the
        // network natively — the SW must NOT intercept them, or it returns a
        // "redirected" response to a navigation and the browser shows a blank
        // page. Excludes /api from the SPA navigation fallback…
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // …and only cache /api *data* requests, never /api/auth/* (OAuth
            // 302s must pass straight through to the browser).
            urlPattern: /^\/api\/(?!auth\/)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  optimizeDeps: {
    exclude: ['sharp'],
    include: ['@turf/great-circle', '@turf/helpers'],
  },
  build: {
    rollupOptions: {
      external: ['sharp'],
    },
  },
})
