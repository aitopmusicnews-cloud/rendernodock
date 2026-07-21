import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Helps Vite resolve '@/' imports inside apps/web/src
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Specifies the output directory for production builds
    outDir: 'dist',
    sourcemap: false,
  },
});