import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offlineBuild } from './scripts/offline-build';
import { existsSync, readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [react(), offlineBuild()],
  base: process.env.PAGES_BASE || './',
  define: { __APP_VERSION__: JSON.stringify(existsSync('VERSION') ? readFileSync('VERSION', 'utf8').trim() : 'development') },
  build: { target: 'es2022' },
});
