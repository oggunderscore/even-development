/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'esnext' }, // top-level await for waitForEvenAppBridge()
  test: { include: ['src/**/*.test.ts'] },
})
