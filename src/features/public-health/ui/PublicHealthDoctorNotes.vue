<script setup lang="ts">
import { SECTION_TITLES } from '../lib/publicHealthContract';
import type { PublicHealthResult } from '../types';

defineProps<{ warnings: PublicHealthResult['warnings'] }>();
</script>

<template>
  <aside v-if="warnings.length" class="doctor-notes" aria-label="医生提醒（不回写）">
    <h2 class="doctor-notes-title">医生提醒（不回写）</h2>
    <p class="doctor-notes-intro">以下内容供医生核对，不纳入患者处方正文或 PHIS 回写。</p>
    <ul class="doctor-notes-list">
      <li v-for="(warning, index) in warnings" :key="`${warning.code}-${index}`" class="doctor-note">
        <span v-if="warning.sectionId" class="doctor-note-section">{{ SECTION_TITLES[warning.sectionId] }}</span>
        <p class="doctor-note-message">{{ warning.message }}</p>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.doctor-notes{margin-top:16px;padding:14px 16px;border:1px solid #e7d5af;border-radius:8px;background:#fffaf1;color:#765623}.doctor-notes-title{margin:0;font-size:14px;font-weight:600}.doctor-notes-intro{margin:6px 0 12px;font-size:11px;line-height:1.7;color:#947b52}.doctor-notes-list{list-style:none;margin:0;padding:0}.doctor-note+.doctor-note{margin-top:12px;padding-top:12px;border-top:1px solid #eee0c4}.doctor-note-section{display:block;margin-bottom:4px;font-size:11px;font-weight:600}.doctor-note-message{margin:0;white-space:pre-wrap;font-size:12px;line-height:1.8;overflow-wrap:anywhere}
</style>
