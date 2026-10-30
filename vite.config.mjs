import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/data/**', '**/backups/**', '**/server/**', '**/server.mjs', '**/new-api/**'] },
    proxy: { '/api/portal': { target: 'http://127.0.0.1:8787', changeOrigin: true }, '/setup': { target: 'http://127.0.0.1:8787', changeOrigin: true }, '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: true, timeout: 300000 } },
  },
});
