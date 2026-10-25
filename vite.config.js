import { defineConfig } from 'vite';

/*
 * Сервер слушает 0.0.0.0 и принимает любой Host — так приложение открывается и локально,
 * и через прокси предпросмотра.
 *
 * HMR по умолчанию работает как обычно (ws на том же адресе). Если приложение открыто
 * через https-прокси, где WebSocket идёт на 443, запускайте с KAITOS_HMR_WSS=1 —
 * тогда клиент HMR переключится на wss. Без этой переменной обычный `npm run dev`
 * на localhost не пишет ошибок в консоль.
 *
 * /api проксируется на локальный сервер файлов (npm run server, порт 5178):
 * браузер обращается к своему же адресу, поэтому нет ни CORS, ни токена в адресной строке.
 */
const behindHttpsProxy = process.env.KAITOS_HMR_WSS === '1';
const apiTarget = process.env.KAITOS_API || 'http://127.0.0.1:5178';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    ...(behindHttpsProxy ? { hmr: { protocol: 'wss', clientPort: 443 } } : {}),
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
