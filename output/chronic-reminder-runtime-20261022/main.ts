import { addCollection } from '@iconify/vue/offline';
import { iconifyCollections } from '../../src/icons/iconifyCollections';
iconifyCollections.forEach(collection => addCollection(collection as never));
import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');
