import { createApp } from 'vue';
import { addCollection } from '@iconify/vue/offline';
import { iconifyCollections } from '@/icons/iconifyCollections';
import '@/styles/design-tokens.css';
import '@/styles/global-overrides.css';
import App from './App.vue';
iconifyCollections.forEach((collection) => addCollection(collection as never));
createApp(App).mount('#app');
