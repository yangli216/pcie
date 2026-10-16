<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useDrugInstructionsController } from '../model/useDrugInstructionsController';
import { isDrugUsageSection } from '../lib/drugInstructionSections';

const query = ref('');
const article = ref<HTMLElement | null>(null);
const { response, detail, selectedId, searching, loadingDetail, searchError, detailError, sections,
  search, select, changePage, retryDetail } = useDrugInstructionsController();
watch(detail, async value => {
  if (value) {
    await nextTick();
    article.value?.focus({ preventScroll: true });
    article.value?.scrollIntoView?.({ block: 'start' });
  }
});
</script>

<template>
  <section class="drug-instructions" aria-label="药品说明书">
    <form class="drug-search" @submit.prevent="search(query)">
      <label for="drug-instruction-query">药品检索</label>
      <div class="drug-search-row">
        <input id="drug-instruction-query" v-model="query" maxlength="128" autocomplete="off"
          placeholder="输入药品名称、通用名或拼音" />
        <button type="submit" :disabled="searching">{{ searching ? '检索中…' : '检索' }}</button>
      </div>
    </form>
    <p v-if="searchError" role="alert">{{ searchError }}</p>
    <p v-if="!response && !searchError && !searching" class="hint">检索并选择药品，查看完整用药说明。</p>
    <p v-if="searching" role="status">正在检索药品…</p>
    <p v-if="response && !response.records.length" role="status">未找到匹配药品，请调整名称或拼音后重试。</p>
    <div v-if="response?.records.length" class="drug-reader">
      <aside class="drug-candidates" aria-label="药品候选">
        <p class="hint">请核对规格和厂家后选择药品</p>
        <ul>
          <li v-for="item in response.records" :key="item.productId">
            <button type="button" class="drug-candidate" :aria-pressed="selectedId === item.productId" @click="select(item)">
              <strong>{{ item.productName }}</strong>
              <span v-if="item.genericName && item.genericName !== item.productName">{{ item.genericName }}</span>
              <span>{{ [item.drugSpec, item.drugForm].filter(Boolean).join(' · ') || '规格未提供' }}</span>
              <span>{{ item.producer || '厂家未提供' }}</span>
            </button>
          </li>
        </ul>
        <nav class="drug-pagination" aria-label="药品检索分页">
          <button type="button" :disabled="response.current <= 1" @click="changePage(response.current - 1)">上一页</button>
          <span>第 {{ response.current }} 页</span>
          <button type="button" :disabled="!response.hasMore || response.current >= 1000" @click="changePage(response.current + 1)">下一页</button>
        </nav>
      </aside>
      <div class="drug-detail" aria-live="polite" :aria-busy="loadingDetail">
        <p v-if="loadingDetail" role="status">正在加载用药说明…</p>
        <div v-else-if="detailError">
          <p role="alert">{{ detailError }}</p>
          <button type="button" @click="retryDetail">重试加载</button>
        </div>
        <article v-else-if="detail" ref="article" tabindex="-1" aria-label="用药说明">
          <header class="drug-detail-header">
            <h3>{{ detail.productName }}</h3>
            <p>{{ [detail.drugSpec, detail.drugForm, detail.producer].filter(Boolean).join(' · ') }}</p>
          </header>
          <p v-if="!detail.summary.trim()" role="status">暂无用药说明</p>
          <template v-else>
            <nav v-if="sections.some(section => section.heading)" class="drug-chapters" aria-label="说明书章节">
              <template v-for="(section, index) in sections" :key="index">
                <a v-if="section.heading" :href="`#drug-chapter-${index}`">{{ section.heading.trim() }}</a>
              </template>
            </nav>
            <section v-for="(section, index) in sections" :id="`drug-chapter-${index}`" :key="index"
              class="drug-section" :class="{ 'drug-section--usage': isDrugUsageSection(section) }">
              <h4 v-if="section.heading">{{ section.heading }}</h4>
              <p class="drug-summary">{{ section.content }}</p>
            </section>
          </template>
        </article>
        <p v-else class="hint">选择左侧药品查看用药说明。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.drug-instructions { display: grid; gap: 16px; min-width: 0; container-type: inline-size; }
.drug-search { display: grid; gap: 8px; }
.drug-search label { font-size: 13px; font-weight: 600; }
.drug-search-row { display: flex; gap: 8px; }
.drug-search input { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid var(--color-border-light, #dbe3eb); border-radius: 6px; background: var(--color-background-white, #fff); color: inherit; font: inherit; font-size: 13px; }
button { padding: 8px 12px; border: 1px solid var(--color-border-light, #dbe3eb); border-radius: 6px; color: inherit; background: var(--color-background-white, #fff); font: inherit; font-size: 13px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, a:focus-visible, article:focus-visible { outline: 2px solid var(--color-primary, #008577); outline-offset: 2px; }
.drug-search button { background: var(--color-primary, #008577); color: #fff; }
.hint { color: var(--color-text-muted, #64748b); font-size: 13px; margin: 0; }
[role="alert"] { color: var(--color-danger, #b42318); overflow-wrap: anywhere; }
.drug-reader { display: grid; grid-template-columns: minmax(200px, 28%) minmax(0, 1fr); gap: 20px; align-items: start; }
.drug-candidates { min-width: 0; display: grid; gap: 12px; }
ul { list-style: none; margin: 0; padding: 3px; display: grid; gap: 6px; max-height: 360px; overflow: auto; }
.drug-candidate { display: grid; gap: 5px; width: 100%; text-align: left; overflow-wrap: anywhere; }
.drug-candidate span { font-size: 12px; color: var(--color-text-muted, #64748b); }
.drug-candidate[aria-pressed="true"] { border-color: var(--color-primary, #008577); box-shadow: inset 3px 0 var(--color-primary, #008577); }
.drug-pagination { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 12px; }
.drug-pagination button { padding: 5px 7px; font-size: 12px; }
.drug-detail { min-width: 0; border-left: 1px solid var(--color-border-light, #dbe3eb); padding-left: 20px; }
.drug-detail-header h3 { margin: 0 0 8px; font-size: 18px; }
.drug-detail-header p { color: var(--color-text-muted, #64748b); font-size: 13px; overflow-wrap: anywhere; }
.drug-chapters { display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 12px 0; border-bottom: 1px solid var(--color-border-light, #dbe3eb); }
.drug-chapters a { font-size: 12px; color: var(--color-primary, #008577); text-decoration: underline; text-underline-offset: 3px; }
.drug-section { padding: 12px 0; scroll-margin-top: 16px; }
.drug-section h4 { margin: 0; font-size: 14px; }
.drug-section--usage { border-left: 3px solid var(--color-primary, #008577); padding-left: 12px; margin-top: 8px; }
.drug-summary { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; font-size: 14px; margin: 0; }
@container (max-width: 620px) { .drug-reader { grid-template-columns: 1fr; } .drug-candidates ul { max-height: 180px; } .drug-detail { border-left: 0; border-top: 1px solid var(--color-border-light, #dbe3eb); padding: 16px 0 0; } }
</style>
