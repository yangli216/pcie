import { computed, readonly, shallowRef } from 'vue';
import { isPMPHAIConfigured, pmphaiService } from '@services/pmphai';

interface PmphaiPageDependencies {
  configured: () => boolean;
  getUrl: () => Promise<string | null>;
  open: (url: string) => Promise<void>;
}

async function openPage(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch { window.open(url, '_blank', 'noopener,noreferrer'); }
}

export function usePmphaiKnowledgePage(deps: PmphaiPageDependencies = {
  configured: isPMPHAIConfigured,
  getUrl: () => pmphaiService.getPageUrl({ pageName: 'home' }),
  open: openPage,
}) {
  const opening = shallowRef(false);
  const error = shallowRef('');
  const configured = computed(deps.configured);
  let disposed = false;
  async function open() {
    if (disposed || opening.value || !deps.configured()) return;
    opening.value = true; error.value = '';
    try {
      const url = await deps.getUrl();
      if (disposed) return;
      if (!url || !/^https?:\/\//i.test(url)) throw new Error('invalid page URL');
      await deps.open(url);
    } catch { if (!disposed) error.value = '人卫知识页面暂时无法打开，请重试或联系管理员。'; }
    finally { if (!disposed) opening.value = false; }
  }
  function dispose() { disposed = true; opening.value = false; }
  return { configured, opening: readonly(opening), error: readonly(error), open, dispose };
}
