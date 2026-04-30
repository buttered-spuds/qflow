import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: false,
  // Prepend the shebang so the output file is directly executable
  banner: {
    js: '#!/usr/bin/env node',
  },
});
