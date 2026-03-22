import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/auth': { target: 'http://localhost:3001', secure: false },
      '/users': { target: 'http://localhost:3001', secure: false },
      '/friend-request': { target: 'http://localhost:3001', secure: false },
      '/friends': { target: 'http://localhost:3001', secure: false },
      '/messages': { target: 'http://localhost:3001', secure: false },
      '/calls': { target: 'http://localhost:3001', secure: false },
      '/socket.io': {
        target: 'ws://localhost:3001',
        ws: true,
        secure: false
      }
    }
  }
})
