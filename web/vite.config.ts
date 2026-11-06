import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.KNEEDEEP_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // host: true lets a phone on the same Wi-Fi open the reporter page.
    host: true,
    proxy: {
      '/v1': API,
      '/health': API,
    },
  },
});
