import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const RENDERER_SERVER_PORT = 5178

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: [
          'electron',
          'better-sqlite3',
          '@napi-rs/canvas',
          '@node-rs/jieba',
          '@libsql/client'
        ]
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    server: {
      port: RENDERER_SERVER_PORT,
      strictPort: false
    },
    preview: {
      port: RENDERER_SERVER_PORT,
      strictPort: false
    },
    plugins: [react()]
  }
})
