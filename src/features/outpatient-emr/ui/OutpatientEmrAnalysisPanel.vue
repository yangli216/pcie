<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import type {
  OutpatientEmrAnalysisStatus,
  OutpatientEmrWritebackStatus,
} from '../types';

const props = defineProps<{
  analysisStatus: OutpatientEmrAnalysisStatus;
  writebackStatus: OutpatientEmrWritebackStatus;
  fieldCount: number;
  errorCode?: string;
  errorMessage?: string;
  writebackMessage?: string;
}>();

const presentation = computed(() => {
  if (props.analysisStatus === 'analyzing') {
    return {
      icon: 'lucide:loader-circle',
      title: '正在分析模板字段',
      detail: `本次只分析 ${props.fieldCount} 个可回填字段`,
      tone: 'working',
    };
  }
  if (props.analysisStatus === 'error') {
    return {
      icon: 'lucide:triangle-alert',
      title: props.errorCode || '分析失败',
      detail: props.errorMessage || '请检查模板与病历上下文后重试',
      tone: 'error',
    };
  }
  if (props.analysisStatus === 'draft') {
    return { icon: 'lucide:file-text', title: '当前病历草稿', detail: '', tone: 'idle' };
  }
  if (props.analysisStatus === 'ready') {
    return {
      icon: 'lucide:circle-check',
      title: '分析完成，等待医生确认',
      detail: `已生成 ${props.fieldCount} 个模板字段草稿，可直接在病历中修改`,
      tone: 'ready',
    };
  }
  return {
    icon: 'lucide:file-text',
    title: '等待模板分析',
    detail: '收到 HIS 当前模板后开始分析',
    tone: 'idle',
  };
});

const writebackLabel = computed(() => {
  if (props.writebackStatus === 'submitting') return '正在发送参数';
  if (props.writebackStatus === 'pending') return props.writebackMessage || '等待 HIS 回执';
  if (props.writebackStatus === 'success') return props.writebackMessage || 'HIS 已完成回填';
  if (props.writebackStatus === 'failed') return props.writebackMessage || 'HIS 回填失败，可修改后重试';
  return '';
});
</script>

<template>
  <aside class="analysis-panel" :data-tone="presentation.tone">
    <div class="analysis-icon" :class="{ spinning: analysisStatus === 'analyzing' }">
      <Icon :icon="presentation.icon" :size="20" />
    </div>
    <div class="analysis-copy">
      <strong>{{ presentation.title }}</strong>
      <span v-if="presentation.detail">{{ presentation.detail }}</span>
      <span
        v-if="writebackLabel"
        class="writeback-status"
        :data-status="writebackStatus"
      >
        {{ writebackLabel }}
      </span>
    </div>
  </aside>
</template>

<style scoped>
.analysis-panel {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 16px;
  border: 1px solid #dce5ef;
  border-radius: 12px;
  background: #f8fafc;
}

.analysis-panel[data-tone='working'] {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.analysis-panel[data-tone='ready'] {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.analysis-panel[data-tone='error'] {
  border-color: #fecaca;
  background: #fff7f7;
}

.analysis-icon {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 9px;
  color: #2563eb;
  background: #dbeafe;
}

.analysis-panel[data-tone='ready'] .analysis-icon {
  color: #15803d;
  background: #dcfce7;
}

.analysis-panel[data-tone='error'] .analysis-icon {
  color: #b91c1c;
  background: #fee2e2;
}

.analysis-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.analysis-copy strong {
  color: #172033;
  font-size: 14px;
}

.analysis-copy span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.writeback-status[data-status='failed'] {
  color: #b91c1c;
}

.writeback-status[data-status='success'] {
  color: #15803d;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
