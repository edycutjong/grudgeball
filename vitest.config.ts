import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Scoped to the pure/testable layers: shared domain logic and the
      // server core + routes (all mockable via RedisLike/@devvit/web/server
      // stubs, no live platform needed). src/client/** (Canvas/Phaser
      // rendering) and src/server/index.ts (process bootstrap — calls
      // serve() at import time) are excluded on purpose: they need a real
      // browser/runtime to exercise meaningfully, same "client is playable
      // core, not full UI" caveat as the README's Honest Limitations.
      include: ['src/shared/**/*.ts', 'src/server/core/**/*.ts', 'src/server/routes/**/*.ts'],
      // src/client/** + src/server/index.ts: excluded because they need a
      // real browser/runtime (see the comment above). protocol.ts +
      // redisLike.ts: pure `export type`-only files with zero executable
      // statements — every import of them is `import type` (erased at
      // build time), so they never load into V8 and there is nothing to
      // exercise; the html reporter's 0/0 division otherwise renders a
      // misleading "0%" for a file with no code to cover.
      exclude: [
        'src/client/**',
        'src/server/index.ts',
        'src/shared/protocol.ts',
        'src/server/core/redisLike.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
