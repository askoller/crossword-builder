/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: '/crossword-builder/',
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Crossword Builder',
        short_name: 'Crosswords',
        description: 'Build and fill crossword grids on the phone.',
        theme_color: '#F3F4F6',
        background_color: '#F3F4F6',
        display: 'standalone',
        orientation: 'any',
        start_url: '/crossword-builder/',
        scope: '/crossword-builder/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
