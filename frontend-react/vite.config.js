import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const API_URL = env.API_URL || 'http://localhost:8000'
  const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': API_URL,
        '/ws': { target: WS_URL, ws: true },
      },
    },
  }
})
