import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import os from 'node:os';

const useHttps = process.env.HTTPS !== '0';

/** Find the first non-internal IPv4 address (the machine's LAN IP). */
function getLanIp(): string | undefined {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return undefined;
}

const lanIp = getLanIp();

export default defineConfig({
  root: '.',
  base: '/echoscope/',
  publicDir: 'public',
  define: {
    // Expose LAN IP to runtime so QR URLs can point to it
    ...(lanIp ? { 'import.meta.env.VITE_LAN_IP': JSON.stringify(lanIp) } : {}),
  },
  plugins: [
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: !useHttps,
      },
      manifest: {
        name: 'Echolocation Lab',
        short_name: 'EchoLab',
        start_url: '.',
        display: 'standalone',
        background_color: '#0b0b0b',
        theme_color: '#111111',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png}'],
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css|wasm)$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'echolab-assets' },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    host: true,
    open: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
