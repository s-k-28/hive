import { defineConfig } from 'vitest/config';

// Standalone test config. Does not load the app's React/Vite plugins, so the
// pure swarm-logic suites run fast in a plain node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
