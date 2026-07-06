import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:10000',
      '/upload': 'http://localhost:10000',
      '/files': 'http://localhost:10000',
      '/upload-to-magic': 'http://localhost:10000',
      '/upload-to-log': 'http://localhost:10000',
      '/health': 'http://localhost:10000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
