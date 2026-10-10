import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoot = `${projectRoot}/src`;

export default defineConfig({
  root,
  plugins: [vue()],
  publicDir: `${projectRoot}/public`,
  resolve: { alias: [
    { find: '@services/regionalClient', replacement: `${root}/fake-regional.ts` },
    { find: '@services/pmphai', replacement: `${root}/fake-pmphai.ts` },
    { find: '@features', replacement: `${sourceRoot}/features` },
  ] },
  server: { host: '127.0.0.1', port: 5189, strictPort: true, fs: { allow: [projectRoot] } },
});
