import { createApp } from 'vue';
import { addCollection } from '@iconify/vue/offline';
import { iconifyCollections } from '../../../src/icons/iconifyCollections';
import App from './App.vue';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/global-overrides.css';
import '../../../src/styles/utilities.css';
import '../../../src/styles/global.css';
import '../../../src/styles/layouts/app-layout.css';

iconifyCollections.forEach((collection) => addCollection(collection as never));
createApp(App).mount('#app');
