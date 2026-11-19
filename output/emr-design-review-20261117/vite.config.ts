import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root,
  plugins: [vue()],
  resolve: { alias: [
    { find: /.*\/model\/useInpatientEmrGeneration$/, replacement: `${root}/fake-inpatient.ts` },
    { find: /.*\/model\/useOutpatientEmrAnalysis$/, replacement: `${root}/fake-outpatient.ts` },
    { find: /.*\/api\/inpatientEmrLogOutbox$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@features\/consultation-result$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@\/services\/his$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@\/services\/audioRecorder$/, replacement: `${root}/fake-boundaries.ts` },
    { find: /^@\/services\/aliyunSpeech$/, replacement: `${root}/fake-boundaries.ts` },
    { find: '@features', replacement: `${project}/src/features` },
    { find: '@shared', replacement: `${project}/src/shared` },
    { find: '@entities', replacement: `${project}/src/entities` },
    { find: '@app', replacement: `${project}/src/app` },
    { find: '@services', replacement: `${project}/src/services` },
    { find: '@', replacement: `${project}/src` },
  ] },
  server: { host: '127.0.0.1', port: 5191, strictPort: true, fs: { allow: [project] } },
});
