import { defineConfig } from 'vite';

// Сервер слушает 0.0.0.0 и принимает любой Host — так приложение открывается
// и локально, и через прокси предпросмотра (https://<порт>-<sandbox>.e2b.app).
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { protocol: 'wss', clientPort: 443 },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
});
