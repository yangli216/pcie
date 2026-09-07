import { describe, expect, it } from 'vitest';
import source from '../../../components/ChatPanel.vue?raw';
import { iconifyCollections } from '../../../icons/iconifyCollections';

describe('ChatPanel message layout', () => {
  it('lets assistant replies use the available width while keeping user messages compact', () => {
    expect(source).toMatch(
      /\.msg\.assistant \.msg-container\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(source).toMatch(
      /\.msg\.assistant \.msg-container-item\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(source).toMatch(
      /\.msg\.assistant \.bubble\s*\{[^}]*flex:\s*1;[^}]*width:\s*auto;[^}]*min-width:\s*0;/s,
    );
    expect(source).toMatch(
      /\.msg\.user \.msg-container\s*\{[^}]*max-width:\s*min\(85%,\s*340px\);/s,
    );
  });

  it('exposes a local web-search toggle and forwards it through chat configuration', () => {
    expect(source).toContain('const webSearchEnabled = ref(false);');
    expect(source).toContain('enableWebSearch: webSearchEnabled.value');
    expect(source).toContain('icon="lucide:globe"');
    expect(source).toContain(':aria-pressed="webSearchEnabled"');
    expect(source).toContain(':disabled="sending"');
    expect(source).toMatch(
      /\.web-search-btn\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*flex:\s*0 0 28px;/s,
    );
    expect(source).toMatch(/\.web-search-btn:focus-visible\s*\{[^}]*outline:/s);
    expect(
      iconifyCollections.some(collection => collection.prefix === 'lucide' && Boolean(collection.icons.globe)),
    ).toBe(true);
  });
});
