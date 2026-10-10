import { createApp } from 'vue';
import RuntimeApp from './RuntimeApp.vue';
import '../../src/styles/design-tokens.css';
import '../../src/styles/global-overrides.css';
import './runtime.css';

createApp(RuntimeApp).mount('#app');
