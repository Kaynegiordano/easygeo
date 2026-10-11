import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : le build doit fonctionner en file:// dans Electron
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
