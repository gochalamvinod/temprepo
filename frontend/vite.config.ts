import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    hmr: {
      host: '127.0.0.1',
    },
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/trade': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
      '/history': 'http://127.0.0.1:8080',
      '/quotes': 'http://127.0.0.1:8080',
      '/symbols': 'http://127.0.0.1:8080',
      '/config': 'http://127.0.0.1:8080',
      '/time': 'http://127.0.0.1:8080',
      '/search': 'http://127.0.0.1:8080',
      '/instruments': 'http://127.0.0.1:8080',
      '/pine': 'http://127.0.0.1:8080',
      '/indicators': 'http://127.0.0.1:8080',
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  }
})
