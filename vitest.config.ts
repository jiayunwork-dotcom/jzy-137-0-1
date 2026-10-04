import { defineConfig } from 'vitest/config'

// Point-by-point ingestion tests issue thousands of requests, so allow
// generous timeouts.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
