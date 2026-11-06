import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The scoring engine is shared with the ingestion worker; the app imports it directly.
export default defineConfig({
  // Relative asset paths, so the built site works at a domain root or under a
  // repository sub-path on GitHub Pages without rebuilding. Routing is by hash.
  base: './',
  plugins: [react()],
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: {
    alias: { '@engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)) }
  },
  server: { port: 5190 }
});
