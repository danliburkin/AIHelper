import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
  },
  preview: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
  },
});
