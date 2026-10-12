import { usePublicHealthController } from './model/usePublicHealthController';
import { generatePublicHealth } from './api/publicHealthGeneration';
import { publicHealthBridge } from './api/publicHealthBridge';

export { default as PublicHealthPage } from './ui/PublicHealthPage.vue';
export type { PublicHealthController } from './model/usePublicHealthController';
export type { PublicHealthLaunch, PublicHealthFeedbackEvent } from './types';
export { publicHealthBridge };
export function createPublicHealthController() {
  return usePublicHealthController({ generate: generatePublicHealth, ...publicHealthBridge });
}
