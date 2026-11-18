import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(root, 'src/deformation'),
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    fs: {
      allow: [path.resolve(root, '..')],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
  },
  test: {
    root,
    environment: 'node',
    include: ['src/deformation/test/**/*.test.ts', 'src/impact/test/**/*.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
