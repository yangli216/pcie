import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({ root, plugins: [vue()], resolve: { alias: [
  { find: '@features', replacement: `${project}/src/features` },
  { find: '@shared', replacement: `${project}/src/shared` },
  { find: '@', replacement: `${project}/src` },
] }, server: { host: '127.0.0.1', port: 5194, strictPort: true, fs: { allow: [project] } } });
