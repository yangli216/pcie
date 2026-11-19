import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const sourceRoot = `${projectRoot}/src`;

export default defineConfig({
  root,
  plugins: [vue()],
  publicDir: false,
  resolve: { alias: [
    { find: /^\.\.\/model\/useInpatientEmrGeneration$/, replacement: `${root}/fake-model.ts` },
    { find: /^\.\.\/api\/inpatientEmrLogOutbox$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@features\/consultation-result$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@\/services\/his$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@\/services\/audioRecorder$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@\/services\/aliyunSpeech$/, replacement: `${root}/fake-boundaries.ts` },
    { find: '@features', replacement: `${sourceRoot}/features` },
    { find: '@shared', replacement: `${sourceRoot}/shared` },
    { find: '@entities', replacement: `${sourceRoot}/entities` },
    { find: '@app', replacement: `${sourceRoot}/app` },
    { find: '@services', replacement: `${sourceRoot}/services` },
    { find: '@', replacement: sourceRoot },
  ] },
  server: { host: '127.0.0.1', port: 5197, strictPort: true, fs: { allow: [projectRoot] } },
});
