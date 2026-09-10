<template>
  <div class="consultation-page">
    <!-- Top: Patient Info -->
    <PatientHeader v-if="currentView !== 'record'" :patient="patientInfo" :avatar="avatarSrc">
      <template #actions>
        <template v-if="currentView === 'consultation'">
          <!-- actions moved to consultation-footer -->
        </template>
        <template v-else>
             <button class="header-btn primary" @click="printReport">打印</button>
             <button class="header-btn primary" :disabled="isWritingRecord" @click="submitToHIS">完成问诊</button>
        </template>
      </template>
    </PatientHeader>

    <div class="content-container" v-if="currentView === 'consultation'">
      <!-- Left: Symptom Shortcuts -->
      <aside class="symptom-sidebar">
        <!-- Mode Switch: 西医 / 中医 - vertical tabs on left edge -->
        <div class="sidebar-mode-switch">
          <button
            type="button"
            :class="['sidebar-switch-btn', { active: consultationMode === 'western' }]"
            :aria-pressed="consultationMode === 'western'"
            @click="consultationMode = 'western'"
          >西医</button>
          <button
            type="button"
            :class="['sidebar-switch-btn', { active: consultationMode === 'tcm' }]"
            @click="showToast('中医模块开发中', 'info')"
          >中医</button>
        </div>
        <!-- Symptom content area -->
        <div class="sidebar-content">
        <!-- Selection Mode Tabs (always visible) -->
        <div class="selection-tabs">
          <button
            type="button"
            :class="['tab-btn', { active: selectionMode === 'common' }]"
            :aria-pressed="selectionMode === 'common'"
            @click="selectionMode = 'common'"
          >
            常用症状
          </button>
          <button
            type="button"
            :class="['tab-btn', { active: selectionMode === 'bodyPart' }]"
            :aria-pressed="selectionMode === 'bodyPart'"
            @click="selectionMode = 'bodyPart'"
          >
            按部位
          </button>
          <button
            type="button"
            :class="['tab-btn', { active: selectionMode === 'system' }]"
            :aria-pressed="selectionMode === 'system'"
            @click="selectionMode = 'system'"
          >
            按系统
          </button>
        </div>

        <div class="search-box">
          <input
            type="text"
            v-model="searchQuery"
            aria-label="搜索症状"
            placeholder="搜索症状(支持首字母)"
            class="search-input"
          />
          <svg class="search-box-svg" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8275" width="14" height="14"><path d="M949.888 904.64l-154.816-154.816a416
          416 0 1 0-45.248 45.248l154.816 154.816a32 32 0 0 0 45.184-45.248zM127.936 479.68a352 352 0
          1 1 352 352 352 352 0 0 1-352-352z m0 0" p-id="8276" fill="#999999"></path></svg>
        </div>

        <template v-if="!searchQuery.trim()">
          <div v-if="selectionMode === 'common'" class="selection-content">
            <div class="common-filter-header">
              <div class="category-filter-container" ref="categoryFilterRef">
                <button type="button" class="category-trigger" :class="{ active: isCategoryDropdownOpen }" :aria-expanded="isCategoryDropdownOpen" aria-controls="symptom-category-dropdown" @click="toggleCategoryDropdown">
                  <span class="trigger-text">{{ categoryButtonText }}</span>
                  <svg class="trigger-icon" :class="{ rotate: isCategoryDropdownOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>

                <div v-show="isCategoryDropdownOpen" id="symptom-category-dropdown" class="category-dropdown" role="group" aria-label="筛选症状系统">
                  <button type="button" class="category-option" :class="{ selected: selectedCategories.length === 0 }" :aria-pressed="selectedCategories.length === 0" @click="toggleCategory('all')">
                      <span class="checkbox-custom" :class="{ checked: selectedCategories.length === 0 }" aria-hidden="true"></span>
                      <span>全部系统</span>
                  </button>
                  <div class="dropdown-divider"></div>
                  <button v-for="cat in uniqueCategories" :key="cat.key" type="button" class="category-option" :class="{ selected: selectedCategories.includes(cat.key) }" :aria-pressed="selectedCategories.includes(cat.key)" @click="toggleCategory(cat.key)">
                      <span class="checkbox-custom" :class="{ checked: selectedCategories.includes(cat.key) }" aria-hidden="true"></span>
                      <span>{{ cat.label }}</span>
                  </button>
                </div>
              </div>
            </div>
            <ul class="symptom-list" v-show="filteredSymptoms.length > 0">
              <li
                v-for="symptom in filteredSymptoms"
                :key="symptom.key"
                :class="{ active: selectedSymptoms.some(s => s.key === symptom.key) }"
              >
                <button type="button" class="symptom-option" :aria-pressed="selectedSymptoms.some(s => s.key === symptom.key)" @click="selectSymptom(symptom)">{{ symptom.name }}</button>
              </li>
            </ul>
          </div>

          <div v-if="selectionMode === 'bodyPart'" class="selection-content">
            <BodyPartSelector
              :symptoms="allSymptoms"
              :patient-gender="patientGender"
              :selected-symptoms="selectedSymptoms"
              @select-symptom="selectSymptom"
            />
          </div>

          <div v-if="selectionMode === 'system'" class="selection-content">
            <SystemCategorySelector
              :symptoms="allSymptoms"
              :selected-symptoms="selectedSymptoms"
              @select-symptom="selectSymptom"
            />
          </div>
        </template>

        <template v-else>
          <div class="selection-content immersive-search">
            <ul class="symptom-list" v-if="filteredSymptoms.length > 0">
              <li
                v-for="symptom in filteredSymptoms"
                :key="symptom.key"
                :class="{ active: selectedSymptoms.some(s => s.key === symptom.key) }"
              >
                <button type="button" class="symptom-option" :aria-pressed="selectedSymptoms.some(s => s.key === symptom.key)" @click="selectSymptom(symptom)">{{ symptom.name }}</button>
              </li>
            </ul>

            <div v-else class="ai-add-symptom">
               <div class="empty-state-icon">
                 <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
               </div>
               <p class="empty-state-text">未找到相关症状</p>
               <button 
                 type="button"
                 class="ai-add-btn" 
                 :disabled="isGeneratingSymptom"
                 @click="handleGenerateDynamicSymptom(searchQuery.trim())"
               >
                 <Icon v-if="isGeneratingSymptom" icon="lucide:loader-2" class="animate-spin" size="16" style="margin-right: 6px;"/>
                 <Icon v-else icon="lucide:sparkles" size="16" style="margin-right: 6px;"/>
                 <span>{{ isGeneratingSymptom ? 'AI 生成属性中...' : `AI 新增: ${searchQuery}` }}</span>
               </button>
            </div>
          </div>
        </template>
        </div><!-- end sidebar-content -->
      </aside>

      <!-- Right: Dynamic Form -->
      <main class="form-container" v-if="selectedSymptoms.length > 0">
        <div class="forms-scroll-area">
          <template v-for="item in renderList" :key="item.key">
            <div class="symptom-form-section">
              <div class="form-header">
                <h2>{{ item.key === 'general' ? item.name : (item.name + ' - 症状属性问诊') }}</h2>
                <button v-if="item.key !== 'general'" class="icon-btn remove-btn" @click="removeSymptom(item)" title="移除此症状">
                  <Icon icon="lucide:trash-2" size="16"/>
                </button>
              </div>
      
              <div class="dynamic-form">
                <template v-for="section in item.config.sections" :key="section.id">
                  <template v-if="isFieldApplicable(section, patientInfo)">
                    <!-- Section Title (shown for multi-section forms like TCM) -->
                    <h3 v-if="item.config.sections.length > 1" class="section-title">{{ section.title }}</h3>

                    <!-- Iterate over fields -->
                    <template v-for="field in section.fields" :key="field.id">
                    <div
                      v-if="isFieldApplicable(field, patientInfo)"
                      class="form-field"
                      :id="'field-' + item.key + '-' + field.storageKey"
                      :class="{ 'has-error': hasFieldValidationError(item.key, field) }"
                    >
                    <label class="field-label">{{ field.label }}</label>
                    
                    <!-- Field Type: input_radio (e.g., OnsetTime) -->
                    <div v-if="field.type === 'input_radio'" class="field-input-radio">
                      <input 
                        type="text" 
                        v-model="formData[item.key][field.storageKey].inputValue" 
                        :placeholder="field.props.placeholder"
                        class="text-input"
                      />
                      <div class="radio-group">
                        <label 
                          v-for="opt in field.props.radioOptions" 
                          :key="opt" 
                          class="radio-label"
                          :class="{ 'is-active': formData[item.key][field.storageKey].radioValue === opt }"
                        >
                          <input 
                            type="radio" 
                            :name="field.id + '_' + item.key" 
                            :value="opt" 
                            v-model="formData[item.key][field.storageKey].radioValue"
                          />
                          {{ opt }}
                        </label>
                      </div>
                    </div>
      
                    <!-- Field Type: radio -->
                    <div
                      v-else-if="field.type === 'radio'"
                      class="field-radio"
                      :id="resolveOtherDetailFieldId(item.key, field)"
                    >
                      <div class="radio-group">
                        <label
                          v-for="opt in field.props.options"
                          :key="opt"
                          class="radio-label"
                          :class="{ 'is-active': formData[item.key][field.storageKey] === opt }"
                        >
                          <input
                            type="radio"
                            :name="field.id + '_' + item.key"
                            :value="opt"
                            v-model="formData[item.key][field.storageKey]"
                          />
                          {{ opt }}
                        </label>
                      </div>
                      <input
                        v-if="shouldShowRadioOtherInput(item.key, field)"
                        v-model="formData[item.key][field.props.otherDetailKey]"
                        type="text"
                        :placeholder="field.props.otherPlaceholder || '请输入详情'"
                        class="text-input radio-other-input"
                      />
                    </div>

                    <!-- Field Type: checkbox -->
                    <div v-else-if="field.type === 'checkbox'" class="field-checkbox">
                      <div class="checkbox-group">
                        <label
                          v-for="opt in field.props.options"
                          :key="opt"
                          class="checkbox-label"
                          :class="{ 'is-active': formData[item.key][field.storageKey]?.includes(opt) }"
                        >
                          <input
                            type="checkbox"
                            :value="opt"
                            :checked="formData[item.key][field.storageKey]?.includes(opt)"
                            @change="(e) => handleCheckboxChange(e, field, item.key)"
                          />
                          {{ opt }}
                        </label>
                      </div>
                    </div>
      
                    <!-- Field Type: number -->
                    <div v-else-if="field.type === 'number'" class="field-number">
                      <input 
                        type="number" 
                        v-model="formData[item.key][field.storageKey]" 
                        :placeholder="field.props.placeholder"
                        class="text-input"
                      />
                      <span v-if="field.props.unit" class="unit">{{ field.props.unit }}</span>
                    </div>
      
                     <!-- Field Type: input -->
                     <div v-else-if="field.type === 'input'" class="field-input">
                      <input 
                        type="text" 
                        v-model="formData[item.key][field.storageKey]" 
                        :placeholder="field.props.placeholder"
                        class="text-input"
                      />
                    </div>
      
                    </div>
                  </template>
                  </template>
                </template>
              </div>

              <!-- 伴随症状推荐 (per-symptom) -->
              <div v-if="item.key !== 'general' && item.key !== 'tcm_signs' && getSymptomRecommendations(item.key).length > 0" class="recommendation-panel">
                <div class="recommendation-header">
                  <div class="recommendation-title">
                    <!-- <Icon icon="lucide:sparkles" size="14" /> -->
                    <svg t="1778204819275" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7240" width="14" height="14">
                      <!-- 右上角小圆形 - 颜色 #0CC3FB -->
                      <path d="M636.864 213.568l18.496 8.64a192 192 0 0 1 102.656 119.616l4.16 14.08 16.192 55.04c1.792 6.08 10.496 6.08 12.288 0l16.192-55.04 4.16-14.08a192 192 0 0 1 102.656-119.68l18.496-8.576a6.4 6.4 0 0 0 0-11.648l-18.496-8.64a192 192 0 0 1-102.656-119.616l-4.16-14.08-16.192-55.04c-1.792-6.08-10.496-6.08-12.288 0l-16.192 55.04-4.16 14.08a192.064 192.064 0 0 1-102.656 119.68l-18.496 8.576a6.4 6.4 0 0 0 0 11.648z" fill="#0CC3FB" stroke="#0CC3FB" stroke-width="1"/>
                      <!-- 左下角大圆形 - 颜色 #2469F2 -->
                      <path d="M70.464 517.76a10.944 10.944 0 0 0 0 19.968 547.648 547.648 0 0 1 293.184 326.528l3.2 9.536 5.568 17.024 15.936 48.128a12.8 12.8 0 0 0 24.32 0l15.872-48.128 5.632-17.024 3.2-9.536a547.456 547.456 0 0 1 293.184-326.528 10.944 10.944 0 0 0 0-19.968 547.648 547.648 0 0 1-293.248-326.528l-3.136-9.536-21.504-65.152a12.8 12.8 0 0 0-24.32 0l-15.936 48.128-5.632 17.024-3.136 9.536A547.456 547.456 0 0 1 70.4 517.76z" fill="#2469F2" stroke="#2469F2" stroke-width="1"/>
                    </svg>
                    <span class="recommendation-title-word">伴随症状推荐</span>
                  </div>
                </div>
                <div class="recommendation-chips">
                  <label
                    v-for="rec in getSymptomRecommendations(item.key)"
                    :key="rec.key"
                    class="recommendation-chip"
                    :class="{ checked: isCompanionSelected(rec.key) }"
                  >
                    <input
                      type="checkbox"
                      class="companion-checkbox"
                      :checked="isCompanionSelected(rec.key)"
                      @change="toggleCompanionSymptom(rec.key)"
                    />
                    <span class="companion-name">{{ rec.name }}</span>
                    <button
                      type="button"
                      class="companion-add-btn"
                      @click.prevent.stop="selectSymptom(rec)"
                      title="展开详细问诊"
                    >十</button>
                  </label>
                </div>
              </div>
            </div>
          </template>
        </div>
        
        <!-- Fixed Submit Button Removed -->
      </main>
      <main v-else class="empty-state">
        <div class="empty-icon">
          <img src="/loading.png" alt="AI Agent" />
        </div>
        <p>请选择左侧症状进行问诊</p>
        <span class="sub-text">支持多选，最多{{ CONSULTATION_CONFIG.MAX_SYMPTOMS }}项</span>
      </main>
    </div>

    <!-- Consultation Footer Actions -->
    <div v-if="currentView === 'consultation'" class="consultation-footer">
      <button
          class="footer-submit-btn"
          :disabled="isGenerating"
          :aria-busy="isGenerating"
          @click="handleEndConsultation"
      >
        <Icon v-if="isGenerating" icon="lucide:loader-2" class="animate-spin" size="8" aria-hidden="true" />
        <span>{{ isGenerating ? '生成中' : '生成病历' }}</span>
      </button>
      <button class="footer-cancel-btn" @click="$emit('close')">取消</button>
    </div>

    <!-- Medical Record View -->
    <div v-else-if="currentView === 'record'" class="medical-record-page">
      <SymptomResultEntry
        :initial-patient-data="props.initialPatientData"
        :generated-record="generatedRecord"
        :diagnoses="aiDiagnoses"
        :selected-diagnosis="selectedDiagnosis"
        :medicines="treatmentRecommendations"
        :examinations="examRecommendations"
        :lab-tests="labTestRecommendations"
        :procedures="procedureRecommendations"
        :consultation-round-id="smartConsultationRoundId"
        @cancel="handleAbandonConsultation"
        @secondary-footer-action="currentView = 'consultation'"
        @close="$emit('close')"
      />
    </div>

    <!-- Final Report View -->
    <div v-else-if="currentView === 'final_report'" class="final-report-page">

       <div class="report-paper">
         <h1 class="hospital-title">{{ consultationMode === 'tcm' ? '中医门诊病历' : '门诊病历' }}</h1>
         <div class="report-header">
           <div class="info-row">
              <span>姓名：{{ patientPromptProfile.patientName }}</span>
              <span>性别：{{ patientPromptProfile.gender }}</span>
              <span>年龄：{{ patientPromptProfile.age }}</span>
           </div>
           <div class="info-row">
             <span>科室：{{ consultationMode === 'tcm' ? '中医科' : '全科医学科' }}</span>
             <span>就诊日期：{{ finalRecord?.date }}</span>
             <span>病历号：{{ patientInfo.idCard }}</span>
           </div>
         </div>

         <div class="report-section">
           <div class="section-title">主诉</div>
           <div class="section-content">{{ finalRecord?.record?.chiefComplaint }}</div>
         </div>

         <div class="report-section">
           <div class="section-title">现病史</div>
           <div class="section-content" style="white-space: pre-line;">{{ finalRecord?.record?.historyOfPresentIllness }}</div>
         </div>

         <div class="report-section">
           <div class="section-title">既往史</div>
           <div class="section-content">{{ finalRecord?.record?.pastMedicalHistory }}</div>
         </div>

         <div class="report-section">
           <div class="section-title">过敏史</div>
           <div class="section-content">{{ finalRecord?.record?.allergyHistory }}</div>
         </div>

         <!-- TCM Four Examinations (if in TCM mode) -->
         <div v-if="consultationMode === 'tcm' && finalRecord?.record?.tcmFourExaminations" class="report-section">
           <div class="section-title">中医四诊</div>
           <div class="section-content" style="white-space: pre-line;">{{ finalRecord?.record?.tcmFourExaminations }}</div>
         </div>

         <!-- Physical Examination (Western mode only) -->
         <div v-if="consultationMode !== 'tcm'" class="report-section">
           <div class="section-title">体格检查</div>
           <div class="section-content">T: 36.5℃, P: 78次/分, R: 18次/分, BP: 120/80mmHg。神志清，精神可，心肺听诊无明显异常，腹软无压痛。</div>
         </div>

         <!-- TCM Diagnosis Format -->
         <div v-if="consultationMode === 'tcm'" class="report-section">
           <div class="section-title">诊断</div>
           <div class="section-content">
             <div class="diagnosis-item">
               <div class="tcm-diagnosis-primary">
                 <strong>中医诊断：</strong>{{ finalRecord?.diagnosis?.name }}
                 <span v-if="finalRecord?.diagnosis?.code" class="diagnosis-code">（{{ finalRecord?.diagnosis?.code }}）</span>
               </div>
               <div v-if="finalRecord?.diagnosis?.syndrome" class="tcm-syndrome-line">
                 <strong>辨证：</strong>{{ finalRecord?.diagnosis?.syndrome }}
                 <span v-if="finalRecord?.diagnosis?.syndromeCode" class="diagnosis-code">（{{ finalRecord?.diagnosis?.syndromeCode }}）</span>
               </div>
             </div>
           </div>
         </div>

         <!-- Western Diagnosis Format -->
         <div v-else class="report-section">
           <div class="section-title">初步诊断</div>
           <div class="section-content">
             {{ finalRecord?.diagnosis?.name }}
             <span v-if="finalRecord?.diagnosis?.code" class="diagnosis-code">（{{ finalRecord?.diagnosis?.code }}）</span>
           </div>
         </div>

         <!-- TCM Treatment Principle -->
         <div v-if="consultationMode === 'tcm' && finalRecord?.treatmentPrinciple" class="report-section">
           <div class="section-title">治则治法</div>
           <div class="section-content">{{ finalRecord?.treatmentPrinciple }}</div>
         </div>

         <div class="report-section">
           <div class="section-title">{{ consultationMode === 'tcm' ? '处方' : '处理意见' }}</div>
           <div class="section-content">
             <div v-for="(tx, idx) in finalRecord?.treatments" :key="idx" class="tx-item">
               <div class="tx-header">
                 {{ idx + 1 }}. {{ tx.name }} {{ tx.matchedItem?.spec ? `(${tx.matchedItem.spec})` : '' }}
               </div>
               <div class="tx-usage" v-if="tx.ingredients">
                 <strong>组成：</strong>{{ tx.ingredients }}
               </div>
               <div class="tx-usage" v-if="tx.usage">
                 <strong>用法用量：</strong>{{ tx.usage }}
               </div>
               <div class="tx-reason" v-if="tx.reason">
                 <strong>说明：</strong>{{ tx.reason }}
               </div>
            </div>
           </div>
         </div>

         <div v-if="finalRecord?.medicalAdvice" class="report-section">
           <div class="section-title">医嘱</div>
           <div class="section-content" style="white-space: pre-line;">{{ finalRecord?.medicalAdvice }}</div>
         </div>

         <div class="report-footer">
            <div class="footer-row">
              <span>医师签名：______________</span>
              <span>日期：{{ finalRecord?.date }}</span>
            </div>
         </div>
       </div>
    </div>

    <!-- Fact Check Notification -->
    <FactCheckNotification
      v-model="showFactCheckNotification"
      :result="factCheckResult"
      @confirm="showFactCheckNotification = false"
      @view-details="showFactCheckNotification = false"
    />

    <!-- Fact Check Widget (Right Bottom Corner) -->
    <FactCheckWidget
      :visible="showFactCheckWidget"
      :status="factCheckWidgetStatus"
      :issues="factCheckWidgetIssues"
      :progress="factCheckProgress"
      :checked-count="factCheckCheckedCount"
      :total-count="factCheckTotalCount"
      @close="showFactCheckWidget = false"
      @view-all="showFactCheckWidget = false"
      @issue-click="(issue) => console.log('Issue clicked:', issue)"
    />

    <!-- Knowledge Panel Toggle Button -->
    <button
      v-if="hasKnowledgeResults || knowledgeLoading"
      class="knowledge-toggle-btn"
      :class="{ loading: knowledgeLoading, active: showKnowledgePanel }"
      @click="toggleKnowledgePanel"
      :title="knowledgeLoading ? '正在搜索相关文献...' : '查看相关医学文献'"
    >
      <span v-if="knowledgeLoading" class="spinner-small"></span>
      <span v-else class="knowledge-icon">📚</span>
      <span v-if="!knowledgeLoading && hasKnowledgeResults" class="knowledge-badge">!</span>
    </button>

    <!-- Knowledge Panel -->
    <KnowledgePanel
      v-model:visible="showKnowledgePanel"
      :loading="knowledgeLoading"
      :results="knowledgeResults"
      :search-keyword="knowledgeSearchKeyword"
      :search-type="knowledgeSearchType"
      @close="showKnowledgePanel = false"
    />

    <MutualRecognitionDecisionHost :decision="finalWriteback.mutualRecognition" />

  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, watch, onUnmounted, inject, nextTick } from 'vue';
import symptomAssociations from '../assets/symptom-associations.json';
import { medicalDataService, type DiagnosisItem } from '../services/medicalData';
import { chat, chatFast } from '../services/llm';
import { feedbackService } from '../services/feedback';
import { getHisAdapter } from '../services/his';
import { trackViewChange, trackClick, trackError, trackFormSubmit, trackRecommendationAction } from '../services/operationTracker';
import {
  BodyPartSelector,
  SystemCategorySelector,
} from '@features/symptom-consultation';
import { PROMPTS, DynamicSymptomTemplatePrompt } from '../prompts';
import Icon from '@shared/ui/Icon.vue';
import { formatUserFacingError } from '@shared/lib/errorMessages';
import {
  FactCheckNotification,
  FactCheckWidget,
} from '@features/feedback';
import {
  MutualRecognitionDecisionHost,
  useClinicalResultUserLogController,
  useClinicalResultWritebackPreflight,
  useConsultationReferenceFeedbackListener,
  useMedicalDictionaries,
  useBodySiteOptions,
  useTreatmentGates,
  useTreatmentHydration,
  useTreatmentNormalization,
} from '@features/consultation-result';
import { SymptomResultEntry } from '@features/symptom-consultation';
import {
  KnowledgePanel,
  useKnowledgeSearchController,
} from '@features/knowledge';
import { PatientHeader } from '@entities/patient';
import { resolvePatientAvatar } from '../utils/patientAvatar';
import {
  checkDiagnosis,
  checkExamination,
  checkMedicine,
  checkTCMDiagnosis,
  checkTCMMedicine,
  isReviewerEnabled,
  type FactCheckIssue,
  type FactCheckResult,
} from '../services/factChecker';
import { isFieldApplicable, generateTextsForSymptom } from '../services/textGeneration';
import { pmphaiService, isPMPHAIConfigured } from '../services/pmphai';
import { CONSULTATION_CONFIG } from '../constants/consultationConfig';
import { getTCMTemplates, getWesternTemplates, syncRemoteTemplates } from '../services/templateService';
import { submitConsultationUserLog } from '../services/consultationUserLog';
import {
  applyRecommendationPreferenceRanking,
  buildDiagnosisPreferenceCandidate,
  buildTreatmentPreferenceCandidate,
  trackFinalRecommendationPreferences,
} from '../services/recommendationPreferenceTracker';
import {
  applyCheckboxFieldChange,
  buildConsultationFormValidationResult,
  buildConsultationTreatmentRecommendationContext,
  buildDiagnosisDisplayGroups,
  buildDiagnosisRecommendationsFromRaw,
  buildDiagnosisPrefill,
  buildFinalRecord,
  buildGeneratedRecordPrefillPatch,
  buildMedicalAdvice,
  buildSelectedTreatmentSnapshots,
  buildTcmSignsPromptText,
  buildReferenceStatusEntryFromFeedback,
  buildSmartUserLogSnapshot as buildSymptomSmartUserLogSnapshot,
  generalConditionConfig,
  getDiagnosisIdentity,
  getSymptomFieldKey,
  isStaleRecommendationContext,
  normalizeReferenceFeedbackPayload,
  parseLLMJson as parseSymptomLLMJson,
  readPatientText,
  registerDiagnosisRecommendationFeedbackTargets,
  registerTreatmentRecommendationFeedbackTargets,
  runDiagnosisFactCheck,
  runTreatmentFactCheck,
  resolveReferenceFeedbackItems,
  resolvePastMedicalHistoryFromSources,
  setReferenceStatusesInMap,
  tcmInquiryConfig,
  trackConsultationCompletion,
  useConsultationAssistController,
  useSymptomConsultationFinalWriteback,
  useConsultationRecordDraftGeneration,
  useSymptomCollectionController,
  type DiagnosisDisplayGroup,
  type ReferenceAction,
  type ReferenceFeedbackPayload,
  type ReferenceItemPayload,
  type ReferenceStatusEntry,
} from '@features/symptom-consultation';
import {
  alignMedicineRecommendationsToInventory, assessTreatmentCatalogMatch,
  buildClinicalResultDiagnosisRequestSpec,
  buildClinicalResultTreatmentRecommendationsFromRaw,
  buildClinicalResultTreatmentRequestSpec,
  buildSelectedTreatments,
  getDiagnosisRecommendationFeedbackKey,
  getMatchedItemRaw,
  getMatchedOrderServiceId,
  getTreatmentRecommendationFeedbackKey,
  loadAvailableMedicineInventoryContext,
  readFirstString,
  syncTreatmentExecDeptSelections as syncSharedTreatmentExecDeptSelections,
  type OrderItemResolvers,
} from '@features/clinical-result';
import {
  useSymptomConsultationCacheSession,
} from '../composables/useSymptomConsultationCache';
import { useOutsideInteraction } from '@shared/composables/useOutsideInteraction';
/* WINDOW_SIZES / diagnosisPath imports removed - feature commented out */
import type {
  ConsultationAssistAction,
} from '../types/consultationAssist';
import type { AppPatient } from '../types/appState';
import {
  getPatientContextAgeText,
  getPatientContextAnchorId as resolvePatientContextAnchorId,
  getPatientContextGenderCode,
  getPatientContextGenderText,
  getPatientContextName,
  toConsultationPatient,
} from '../utils/patientContext';

const showToast = inject('showToast') as (msg: string, type: 'success' | 'error' | 'info') => void;

const props = defineProps<{
  initialPatientData?: AppPatient;
  assistTrigger?: {
    kind: ConsultationAssistAction;
    token: number;
  } | null;
  active?: boolean;
}>();
const emit = defineEmits(['close', 'cancel', 'consume-auto-trigger']);

// --- Interfaces & State Definitions ---
import type { Diagnosis, Patient, TreatmentRecommendation, FinalRecord } from '../types/consultation';
import { useVoiceFeedback } from '@features/feedback';
type AssistAction = ConsultationAssistAction;

// Patient info: empty defaults; real data flows in via `initialPatientData` watch.
// 不再预填演示数据，避免在真实就诊场景中显示其他患者的字段（如身份证、电话、民族、婚姻）。
const patientInfo = ref<Patient>({
  "idTet": "",
  "idPi": "",
  "idMpi": "",
  "cdPi": "",
  "naPi": "",
  "sdSex": "",
  "birthday": "",
  "idCard": "",
  "mobilePhone": "",
  "sdNation": "",
  "sdNaty": "",
  "sdBlood": "",
  "sdRhBlood": "",
  "sdMarital": "",
  "sdCard": "",
  "ageNum": 0,
  "ageUnit": "",
  "ageText": "",
  "sdNationText": "",
  "sdNatyText": "",
  "sdMaritalText": "",
  "sdSexText": "",
  "sdBloodText": "",
  "fgActiveText": "",
  "sdRhBloodText": "",
  "sdCardText": "",
  "allergyHistory": ""
});

const avatarSrc = computed(() => {
  const info = patientInfo.value;
  return resolvePatientAvatar({
    gender: getPatientContextGenderCode(info as any),
    sdSexText: getPatientContextGenderText(info as any),
    age: (info as any).ageNum,
    ageUnit: (info as any).ageUnit,
    ageText: getPatientContextAgeText(info as any),
  });
});

// 患者性别（用于 BodyPartSelector）
const patientGender = computed<'male' | 'female'>(() => {
  const genderCode = getPatientContextGenderCode(patientInfo.value as any);
  const genderText = getPatientContextGenderText(patientInfo.value as any);
  const isMale = genderCode === 'M' || genderCode === '1' || genderText === '男性' || genderText === '男';
  return isMale ? 'male' : 'female';
});

const symptoms = shallowRef<any[]>([]);
const selectedSymptoms = ref<any[]>([]);
const formData = ref<Record<string, any>>({});
const searchQuery = ref('');
const isGeneratingSymptom = ref(false);

// Selection mode for sidebar tabs
const selectionMode = ref<'common' | 'bodyPart' | 'system'>('common');
const consultationMode = ref<'western' | 'tcm'>('western');

// 根据问诊模式动态获取模板数据
const currentTemplatesData = computed(() => {
  if (consultationMode.value === 'tcm') {
    return getTCMTemplates();
  }
  return getWesternTemplates();
});

const symptomCollectionController = useSymptomCollectionController({
  symptoms,
  selectedSymptoms,
  formData,
  searchQuery,
  mode: consultationMode,
  generalConfig: generalConditionConfig as any,
  tcmConfig: tcmInquiryConfig as any,
  associations: symptomAssociations as Record<string, string[]>,
  maxSymptoms: CONSULTATION_CONFIG.MAX_SYMPTOMS,
  getPatientGenderCode: () => getPatientContextGenderCode(patientInfo.value as any),
  notifyMaxReached: (maxSymptoms) => {
    showToast(`最多只能选择 ${maxSymptoms} 个症状`, 'info');
  },
  onSelected: ({ symptomKey, symptomName, totalSelected }) => {
    trackClick('symptom_select', { symptomKey, symptomName, totalSelected });
  },
  onDeselected: ({ symptomKey, symptomName }) => {
    trackClick('symptom_deselect', { symptomKey, symptomName });
  },
  onRemoved: ({ symptomKey, symptomName }) => {
    trackClick('symptom_remove', { symptomKey, symptomName });
  },
});
const {
  allSymptoms,
  categoryButtonText,
  categoryFilterRef,
  clearCollection: clearSymptomCollection,
  clearSelection: clearSymptomSelection,
  closeCategoryDropdown,
  companionSymptomNames,
  companionSymptoms,
  filteredSymptoms,
  getSymptomRecommendations,
  initFormData,
  isCategoryDropdownOpen,
  isCompanionSelected,
  removeSymptom,
  renderList,
  selectSymptom,
  selectedCategories,
  toggleCategory,
  toggleCategoryDropdown,
  toggleCompanionSymptom,
  uniqueCategories,
} = symptomCollectionController;
const currentView = ref<'consultation' | 'record' | 'final_report'>('consultation');
const createEmptyGeneratedRecord = () => ({
  chiefComplaint: '',
  historyOfPresentIllness: '',
  tcmFourExaminations: '',
  familyHistory: '',
});
const generatedRecord = ref({ chiefComplaint: '', historyOfPresentIllness: '', tcmFourExaminations: '', familyHistory: '' });
const activePatientAnchorId = ref('');
const assistFocus = ref<AssistAction | null>(null);
const activeReferenceRequest = ref<ReferenceFeedbackPayload | null>(null);
const lastReferenceFeedback = ref<ReferenceFeedbackPayload | null>(null);
const referenceStatusMap = ref<Record<string, ReferenceStatusEntry>>({});

const aiLoading = ref(false);
const aiError = ref<string | null>(null);
const aiDiagnoses = ref<Diagnosis[]>([]);
const selectedDiagnosis = ref<Diagnosis | null>(null);
const relatedDiagnoses = ref<DiagnosisItem[]>([]);
const collapsedDiagnosisGroups = ref<Record<string, boolean>>({});
let aiDiagnosisRequestSeq = 0;

const treatmentLoading = ref(false);
const treatmentError = ref<string | null>(null);
const treatmentRecommendations = ref<TreatmentRecommendation[]>([]);

// 检查推荐（影像/器械）
const examRecommendations = ref<TreatmentRecommendation[]>([]);
const examLoading = ref(false);
const examError = ref<string | null>(null);

// 检验推荐（实验室）
const labTestRecommendations = ref<TreatmentRecommendation[]>([]);
const labTestLoading = ref(false);
const labTestError = ref<string | null>(null);

// 处置推荐
const procedureRecommendations = ref<TreatmentRecommendation[]>([]);
const procedureLoading = ref(false);
const procedureError = ref<string | null>(null);
const selectedTreatments = computed(() => buildSelectedTreatments({
  medicines: treatmentRecommendations.value,
  examinations: examRecommendations.value,
  labTests: labTestRecommendations.value,
  procedures: procedureRecommendations.value,
}));
let treatmentRecommendationRequestSeq = 0;
let examRecommendationRequestSeq = 0;
let labTestRecommendationRequestSeq = 0;
let procedureRecommendationRequestSeq = 0;

// HIS 字典 + 治疗项归一化（与语音问诊共用同一份基础设施）
// 症状侧现已接入“发药药房 / 执行科室”门禁：未设置不允许勾选，不允许参与回写。
const {
  frequencyOptions: hisFrequencyOptions,
  routeOptions: hisRouteOptions,
  pharmacyOptions: hisPharmacyOptions,
  execDeptOptions: hisExecDeptOptions,
  loadAllDictionaries: loadAllHisDictionaries,
} = useMedicalDictionaries();
const treatmentGates = useTreatmentGates({
  pharmacyOptions: hisPharmacyOptions,
  execDeptOptions: hisExecDeptOptions,
});
const treatmentNormalization = useTreatmentNormalization({
  frequencyOptions: hisFrequencyOptions,
  routeOptions: hisRouteOptions,
  ensurePharmacy: treatmentGates.ensurePharmacy,
  isExecDeptSatisfied: treatmentGates.isExecDeptSatisfied,
});
const { applyMedicalItemPartOptions } = useBodySiteOptions();
const treatmentHydration = useTreatmentHydration({
  pharmacyOptions: hisPharmacyOptions,
  getCandidatePharmaciesForMedicine: treatmentGates.pharmacyCandidatesFor,
  findFrequencyOptionByValue: treatmentNormalization.findFrequencyOptionByValue,
  findRouteOptionByValue: treatmentNormalization.findRouteOptionByValue,
  applyMedicalItemPartOptions,
  afterMedicalItemHydrated: syncTreatmentExecDeptSelections,
  logContext: 'ConsultationPage',
  notify: (message, level) => showToast(message, level || 'info'),
});
const noopTreatmentSelector = () => {};
function normalizeTreatmentRecommendation(rec: Partial<TreatmentRecommendation>): TreatmentRecommendation {
  return treatmentNormalization.normalize(rec);
}

async function applyTreatmentPreferenceRanking(
  items: TreatmentRecommendation[],
  scene: string,
): Promise<TreatmentRecommendation[]> {
  return applyRecommendationPreferenceRanking(
    items,
    buildTreatmentPreferenceCandidate,
    {
      consultationId: resolveConsultationId(),
      sourceModule: 'consultation_ai',
      scene,
    },
  );
}

function getAllRecommendationItems(): TreatmentRecommendation[] {
  return [
    ...treatmentRecommendations.value,
    ...examRecommendations.value,
    ...labTestRecommendations.value,
    ...procedureRecommendations.value,
  ];
}

async function syncTreatmentPharmacyScope(): Promise<void> {
  const his = getHisAdapter();
  if (!his) {
    medicalDataService.setActivePharmacyStoreIds(null);
    return;
  }

  const activeStoreIds = hisPharmacyOptions.value
    .map((option) => (option.idSto || '').trim())
    .filter((value): value is string => Boolean(value));

  if (activeStoreIds.length === 0) {
    medicalDataService.setActivePharmacyStoreIds(null);
    return;
  }

  try {
    await medicalDataService.ensureMedicineCatalogForStoreIds(activeStoreIds, his);
  } catch (error) {
    console.error('[ConsultationPage] ensureMedicineCatalogForStoreIds failed', error);
  }
}

function syncTreatmentExecDeptSelections(): void {
  syncSharedTreatmentExecDeptSelections(getAllRecommendationItems(), hisExecDeptOptions.value);
}

async function ensureTreatmentDictionaryStateReady(): Promise<void> {
  await loadAllHisDictionaries();
  await syncTreatmentPharmacyScope();
  syncTreatmentExecDeptSelections();
}

const finalRecord = ref<FinalRecord | null>(null);
const hasRecordDraft = computed(
  () =>
    generatedRecord.value.chiefComplaint.trim() !== '' &&
    generatedRecord.value.historyOfPresentIllness.trim() !== ''
);

/* DiagnosisPathWindowPhase type removed - feature commented out */

/* DIAGNOSIS_PATH timeouts removed - feature commented out */

const diagnosisGroups = computed<DiagnosisDisplayGroup[]>(() =>
  buildDiagnosisDisplayGroups({
    diagnoses: aiDiagnoses.value,
    mode: consultationMode.value === 'tcm' ? 'tcm' : 'western',
    getCategoryInfo: (code) => medicalDataService.getIcd10CategoryInfo(code),
  })
);

/* emitDiagnosisPathStatus / diagnosisPathOptions removed - feature commented out */
const getPatientAnchorId = (patient?: {
  idPi?: string | number;
  patientId?: string | number;
  id?: string | number;
} | null) => resolvePatientContextAnchorId(patient as any);

const resolveConsultationId = (): string =>
  getPatientAnchorId(finalRecord.value?.patient || patientInfo.value) || 'unknown';

const resolvePastMedicalHistory = (): string => resolvePastMedicalHistoryFromSources({
  record: finalRecord.value?.record as unknown as Record<string, unknown> | undefined,
  patient: patientInfo.value as unknown as Record<string, unknown>,
});

const patientPromptProfile = computed(() => ({
  patientName: getPatientContextName(patientInfo.value as any) || '',
  gender: getPatientContextGenderText(patientInfo.value as any) || '',
  age: getPatientContextAgeText(patientInfo.value as any) || '',
}));

const recordDraftGeneration = useConsultationRecordDraftGeneration({
  selectedSymptoms,
  formData,
  mode: computed(() => consultationMode.value === 'tcm' ? 'tcm' : 'western'),
  companionSymptomNames,
  patientProfile: patientPromptProfile,
  tcmConfig: tcmInquiryConfig,
  chatFast,
  buildSymptomTexts: (symptom, data, target, excludeKeys) => (
    generateTextsForSymptom(symptom, data, target, excludeKeys)
  ),
  onAiFallback: (error) => {
    console.warn('[ConsultationPage] AI record draft failed, using local fallback', error);
    trackError('ai_record_draft_failed', error);
    showToast('AI 病历草稿生成失败，已使用本地规则草稿。', 'info');
  },
});

const {
  registerExternalRecommendationTarget,
} = useVoiceFeedback({
  consultationId: computed(() => resolveConsultationId()),
  patientId: computed(() => getPatientAnchorId(patientInfo.value)),
  patientName: computed(() => patientPromptProfile.value.patientName),
  chiefComplaint: computed(() => generatedRecord.value.chiefComplaint || ''),
  historyOfPresentIllness: computed(() => generatedRecord.value.historyOfPresentIllness || ''),
});

const setReferenceStatuses = (
  action: ReferenceAction,
  items: ReferenceItemPayload[],
  entry: ReferenceStatusEntry
): void => {
  referenceStatusMap.value = setReferenceStatusesInMap(
    referenceStatusMap.value,
    action,
    items,
    entry,
  );
};

const buildSmartUserLogSnapshot = () => buildSymptomSmartUserLogSnapshot({
  chiefComplaint: generatedRecord.value.chiefComplaint,
  historyOfPresentIllness: generatedRecord.value.historyOfPresentIllness,
  diagnoses: aiDiagnoses.value,
  selectedDiagnosis: selectedDiagnosis.value,
  medicines: treatmentRecommendations.value,
  examinations: examRecommendations.value,
  labTests: labTestRecommendations.value,
});

const smartConsultationRoundId = ref<string | null>(null);

const smartUserLogController = useClinicalResultUserLogController({
  consultationId: () => resolveConsultationId(),
  consultationRoundId: () => smartConsultationRoundId.value,
  consultationType: 'smart',
  patient: () => patientInfo.value,
  buildSnapshot: buildSmartUserLogSnapshot,
  submit: submitConsultationUserLog,
});
const {
  submitGeneratedUserLog: submitSmartGeneratedUserLog,
  submitFinalUserLog: submitSmartFinalUserLog,
} = smartUserLogController;

const prefillGeneratedRecordFromPatient = (force = false): boolean => {
  const patch = buildGeneratedRecordPrefillPatch({
    patient: patientInfo.value as unknown as Record<string, unknown>,
    currentRecord: generatedRecord.value,
    force,
  });
  if (!patch) {
    return false;
  }

  if (patch.chiefComplaint !== undefined) {
    generatedRecord.value.chiefComplaint = patch.chiefComplaint;
  }
  if (patch.historyOfPresentIllness !== undefined) {
    generatedRecord.value.historyOfPresentIllness = patch.historyOfPresentIllness;
  }
  return true;
};

const prefillDiagnosisFromPatient = (force = false): boolean => {
  const patientRecord = patientInfo.value as unknown as Record<string, unknown>;
  const diagnosisName = readPatientText(
    patientRecord,
    ['diagnosis']
  );
  if (
    !diagnosisName
    || (!force && selectedDiagnosis.value && selectedDiagnosis.value.name.trim() !== '')
  ) {
    return buildDiagnosisPrefill({
      patient: patientRecord,
      currentDiagnosis: selectedDiagnosis.value,
      force,
    }).shouldApply;
  }

  const prefill = buildDiagnosisPrefill({
    patient: patientRecord,
    currentDiagnosis: selectedDiagnosis.value,
    matchedDiagnosis: medicalDataService.matchDiagnosis(diagnosisName),
    force,
  });
  if (prefill.diagnosis) {
    selectedDiagnosis.value = prefill.diagnosis;
  }
  return prefill.shouldApply;
};

const invalidateRecommendationRequests = () => {
  aiDiagnosisRequestSeq += 1;
  treatmentRecommendationRequestSeq += 1;
  examRecommendationRequestSeq += 1;
  labTestRecommendationRequestSeq += 1;
  procedureRecommendationRequestSeq += 1;
};

const resetTreatmentRecommendationState = () => {
  treatmentLoading.value = false;
  treatmentError.value = null;
  treatmentRecommendations.value = [];
  examLoading.value = false;
  examError.value = null;
  examRecommendations.value = [];
  labTestLoading.value = false;
  labTestError.value = null;
  labTestRecommendations.value = [];
  procedureLoading.value = false;
  procedureError.value = null;
  procedureRecommendations.value = [];
  treatmentFactChecks.value.clear();
};

const resetWorkflowState = () => {
  invalidateRecommendationRequests();
  currentView.value = 'consultation';
  assistFocus.value = null;
  clearSymptomCollection();
  searchQuery.value = '';
  generatedRecord.value = createEmptyGeneratedRecord();
  finalRecord.value = null;
  aiLoading.value = false;
  aiError.value = null;
  aiDiagnoses.value = [];
  selectedDiagnosis.value = null;
  relatedDiagnoses.value = [];
  collapsedDiagnosisGroups.value = {};
  resetTreatmentRecommendationState();
  activeReferenceRequest.value = null;
  lastReferenceFeedback.value = null;
  referenceStatusMap.value = {};
  finalWriteback.reset();
  knowledgeLoading.value = false;
  hasKnowledgeResults.value = false;
  showKnowledgePanel.value = false;
  factCheckResult.value = null;
  diagnosisFactChecks.value.clear();
  factCheckWidgetStatus.value = 'idle';
  factCheckWidgetIssues.value = [];
  factCheckProgress.value = 0;
  factCheckCheckedCount.value = 0;
  factCheckTotalCount.value = 0;
  showFactCheckWidget.value = false;
  showFactCheckNotification.value = false;
  smartConsultationRoundId.value = null;
};

/* canOpenDiagnosisPath / openDiagnosisPathWindow removed - template usage commented out */

watch(diagnosisGroups, (groups) => {
  const activeKeys = new Set(groups.map(group => group.key));
  const nextState: Record<string, boolean> = {};

  groups.forEach((group) => {
    nextState[group.key] = collapsedDiagnosisGroups.value[group.key] ?? false;
  });

  Object.keys(collapsedDiagnosisGroups.value).forEach((groupKey) => {
    if (!activeKeys.has(groupKey)) {
      delete nextState[groupKey];
    }
  });

  collapsedDiagnosisGroups.value = nextState;
}, { immediate: true });

// Generating medical record loading state
const isGenerating = ref(false);

// Fact Check State
const showFactCheckNotification = ref(false);
const factCheckResult = ref<FactCheckResult | null>(null);
const diagnosisFactChecks = ref<Map<string, FactCheckResult>>(new Map());
const treatmentFactChecks = ref<Map<string, FactCheckResult>>(new Map());

// Fact Check Widget State
const showFactCheckWidget = ref(false);
const factCheckWidgetStatus = ref<'idle' | 'checking' | 'completed'>('idle');
const factCheckWidgetIssues = ref<FactCheckIssue[]>([]);
const factCheckProgress = ref(0);
const factCheckCheckedCount = ref(0);
const factCheckTotalCount = ref(0);

const {
  showKnowledgePanel,
  knowledgeLoading,
  knowledgeSearchKeyword,
  knowledgeSearchType,
  knowledgeResults,
  hasKnowledgeResults,
  toggleKnowledgePanel,
  searchKnowledgeByDiagnoses,
  searchKnowledgeByTreatment,
  searchKnowledgeFromItems,
} = useKnowledgeSearchController({
  isConfigured: isPMPHAIConfigured,
  searchByCategories: (diagnoses, medications, examinations, options) =>
    pmphaiService.searchByCategories(diagnoses, medications, examinations, options),
  batchSearch: (queries, options) => pmphaiService.batchSearch(queries, options),
  onTrack: (action, details) => trackClick(action, details),
  onError: (error) => {
    console.error('Knowledge base search failed:', error);
    trackError('knowledge_search_failed', error);
  },
  onNotConfigured: () => showToast('请先在设置中配置知识库', 'error'),
});

const symptomCacheSession = useSymptomConsultationCacheSession({
  consultationId: resolveConsultationId,
  currentView,
  consultationMode,
  selectionMode,
  symptoms,
  patientInfo,
  selectedSymptoms,
  formData,
  searchQuery,
  selectedCategories,
  companionSymptoms,
  generatedRecord,
  finalRecord,
  aiDiagnoses,
  selectedDiagnosis,
  relatedDiagnoses,
  treatmentRecommendations,
  examRecommendations,
  labTestRecommendations,
  procedureRecommendations,
  referenceStatusMap,
  activeReferenceRequest,
  lastReferenceFeedback,
  knowledgeSearchKeyword,
  knowledgeSearchType,
  hasKnowledgeResults,
  showKnowledgePanel,
  createEmptyGeneratedRecord,
  getTemplates: (mode) => (mode === 'tcm' ? getTCMTemplates() : getWesternTemplates()),
});

// --- Logic ---

// AI 动态生成症状
const handleGenerateDynamicSymptom = async (name: string) => {
  if (!name || isGeneratingSymptom.value) return;
  try {
    isGeneratingSymptom.value = true;
    showToast(`正在由 AI 分析【${name}】的临床属性...`, 'info');

    const messages = DynamicSymptomTemplatePrompt.buildMessage(name);
    let resultJsonStr = await chat(
      messages,
      undefined,
      undefined,
      undefined,
      {
        traceContext: {
          scene: 'consultation-dynamic-symptom',
          sourceModule: 'consultation_dynamic_symptom',
          operationModule: 'consultation',
          operationAction: 'generate_dynamic_symptom_template',
          title: '生成动态症状模板',
        },
      }
    );

    // 解析格式
    if (resultJsonStr.includes('```json')) {
      resultJsonStr = resultJsonStr.substring(resultJsonStr.indexOf('```json') + 7, resultJsonStr.lastIndexOf('```')).trim();
    } else if (resultJsonStr.includes('```')) {
      resultJsonStr = resultJsonStr.substring(resultJsonStr.indexOf('```') + 3, resultJsonStr.lastIndexOf('```')).trim();
    }

    const fields = JSON.parse(resultJsonStr);
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error('AI 返回数据不合规');
    }

    // 动态构造 Symptom 实体并自动挂载
    const newSymptom = {
      id: `custom_${Date.now()}`,
      key: `custom_${Date.now()}`,
      name: name,
      description: 'AI 动态生成症状',
      isCommonSymptom: false,
      systemCategory: ['other'],
      bodyParts: [],
      config: {
        sections: [{
          id: 'section_0',
          title: `属性填写 (AI 动态生成)`,
          fields: fields
        }]
      },
      applicablePopulation: { genders: [], ageGroups: [] },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    selectSymptom(newSymptom);

    searchQuery.value = ''; // 清空搜索，关闭界面提示
    showToast('已成功添加动态生成的症状模板', 'success');
  } catch (err: any) {
    console.error('动态生成症状失败:', err);
    showToast(formatUserFacingError(err, {
      context: 'AI 生成失败',
      fallback: '请稍后重试。',
    }), 'error');
  } finally {
    isGeneratingSymptom.value = false;
  }
};

const applyReferenceFeedback = (payload: ReferenceFeedbackPayload) => {
  const safePayload = normalizeReferenceFeedbackPayload(payload);
  lastReferenceFeedback.value = safePayload;
  activeReferenceRequest.value =
    activeReferenceRequest.value?.requestId === safePayload.requestId
      ? { ...activeReferenceRequest.value, ...safePayload }
      : activeReferenceRequest.value;

  const items = resolveReferenceFeedbackItems(safePayload, activeReferenceRequest.value);
  if (items.length > 0) {
    setReferenceStatuses(
      safePayload.action,
      items,
      buildReferenceStatusEntryFromFeedback(safePayload),
    );
  }

  feedbackService.logOperation({
    module: 'consultation',
    action: `reference_feedback_${safePayload.action}`,
    title: '接收 PHIS 引用回执',
    sourceModule: 'consultation_reference',
    scene: 'consultation-reference',
    operationType: 'api_call',
    operationName: `reference_feedback:${safePayload.action}`,
    details: safePayload,
    success: safePayload.status === 'success',
  });

  if (safePayload.status === 'success') {
    showToast(safePayload.message || 'PHIS 已完成引用保存。', 'success');
  } else if (safePayload.status === 'pending') {
    showToast(safePayload.message || '等待医生完成检验检查互认决策。', 'info');
  } else if (safePayload.status === 'cancelled') {
    showToast(safePayload.message || '本次互认决策已取消。', 'info');
  } else {
    showToast(safePayload.message || 'PHIS 引用保存失败。', 'error');
  }
};

/* writeRecordToHIS / confirmDiagnosisSelection removed - template usage commented out */

function getDiagnosisFeedbackKey(diag: Diagnosis): string {
  return getDiagnosisRecommendationFeedbackKey(diag);
}

function getTreatmentFeedbackKey(rec: TreatmentRecommendation): string {
  return getTreatmentRecommendationFeedbackKey(rec);
}

/* getTreatmentReferenceButtonLabel removed - per-section reference replaced by batch 一键回写 */

/* referenceSelectedTreatmentsToPHIS removed - per-section reference replaced by batch 一键回写 */

const canSubmitToHIS = computed(() => {
  if (!selectedDiagnosis.value) return false;
  return generatedRecord.value.chiefComplaint.trim().length > 0
    && generatedRecord.value.historyOfPresentIllness.trim().length > 0;
});

watch(() => props.initialPatientData, (newData) => {
  if (newData) {
    const nextPatientId = resolvePatientContextAnchorId(newData);
    const shouldReset = activePatientAnchorId.value !== '' && nextPatientId !== '' && activePatientAnchorId.value !== nextPatientId;

    if (shouldReset) {
      symptomCacheSession.clearSnapshot();
      resetWorkflowState();
      initFormData(generalConditionConfig);
    }

    patientInfo.value = {
      ...patientInfo.value,
      ...toConsultationPatient(newData),
    };
    activePatientAnchorId.value = resolvePatientContextAnchorId(patientInfo.value as any);

    prefillGeneratedRecordFromPatient(shouldReset);
  }
}, { immediate: true });

const symptomOrderResolvers: OrderItemResolvers = {
  getServiceCode: (rec) => (rec.matchedItem?.sdSrv || readFirstString(getMatchedItemRaw(rec), ['sdSrv']) || '').trim(),
  getServiceId: (rec) => getMatchedOrderServiceId(rec),
  getServiceName: (rec) => (rec.matchedItem?.naSrv || readFirstString(getMatchedItemRaw(rec), ['naSrv', 'naCli', 'naMedPro', 'naMed']) || rec.matchedItem?.name || rec.name || '').trim(),
  getExecDeptId: (rec) => (rec.type === 'medicine'
    ? (rec.execDept || rec.matchedItem?.idDeptExec || readFirstString(getMatchedItemRaw(rec), ['idDeptExec', 'idDept']) || '')
    : (rec.execDept || '')).trim(),
  getPartId: (rec) => (rec.bodySiteId || rec.matchedItem?.idPart || readFirstString(getMatchedItemRaw(rec), ['idPart']) || '').trim(),
  getJsonField: (rec) => (rec.matchedItem?.jsonField || readFirstString(getMatchedItemRaw(rec), ['jsonField']) || '').trim(),
  normalize: normalizeTreatmentRecommendation,
};

const { run: runWritebackPreflight } = useClinicalResultWritebackPreflight({
  selectedDiagnoses: computed(() => (selectedDiagnosis.value ? [selectedDiagnosis.value] : [])),
  treatments: selectedTreatments,
  ensureMedicineSelectable: treatmentHydration.ensureMedicineSelectable,
  checkMedicineInventoryEnough: treatmentHydration.checkMedicineInventoryEnough,
  hydrateMedicalItemDetail: treatmentHydration.hydrateMatchedMedicalItemDetail,
  hasRequiredPharmacy: treatmentGates.hasRequiredPharmacy,
  hasRequiredExecDept: treatmentGates.hasRequiredExecDept,
  hasRequiredBodySite: treatmentGates.hasRequiredBodySite,
  openPharmacySelector: noopTreatmentSelector,
  openExecDeptSelector: noopTreatmentSelector,
  openBodySiteSelector: noopTreatmentSelector,
  requiredFieldOptions: {
    resolvers: symptomOrderResolvers,
    normalize: normalizeTreatmentRecommendation,
  },
  notify: (message) => showToast(message, 'info'),
});

const finalWriteback = useSymptomConsultationFinalWriteback({
  resolveConsultationId,
  canSubmit: () => canSubmitToHIS.value,
  getSelectedDiagnosis: () => selectedDiagnosis.value,
  getPatientTetId: () => (patientInfo.value as { idTet?: string }).idTet || '',
  getRecord: () => generatedRecord.value,
  getPastMedicalHistory: resolvePastMedicalHistory,
  runPreflight: runWritebackPreflight,
  orderItemResolvers: symptomOrderResolvers,
  notify: showToast,
  formatError: (error) => formatUserFacingError(error, {
    context: '发送数据失败', fallback: '请稍后重试。',
  }),
  onBeforeSubmit: ({ consultationId, diagnosis, treatments }) => trackFinalRecommendationPreferences({
    diagnoses: [diagnosis], primaryDiagnosis: diagnosis, treatments,
    context: { consultationId, sourceModule: 'consultation', scene: 'smart-consultation-writeback' },
  }),
  onSuccess: (consultationId) => {
    submitSmartFinalUserLog();
    trackFormSubmit('submit_to_his', { patientId: consultationId });
    handleEndSession();
  },
  onError: (error) => {
    console.error('Failed to submit', error);
    trackError('submit_to_his_failed', error);
  },
});
const isWritingRecord = finalWriteback.busy;
const submitToHIS = finalWriteback.submit;

const printReport = () => {
  trackClick('print_report');
  window.print();
};

const handleEndSession = () => {
  trackClick('end_consultation_session');
  symptomCacheSession.clearSnapshot();
  resetWorkflowState();
  initFormData(generalConditionConfig);
  emit('close');
};

const handleAbandonConsultation = () => {
  trackClick('abandon_symptom_consultation', { consultationId: resolveConsultationId() });
  symptomCacheSession.clearSnapshot();
  resetWorkflowState();
  initFormData(generalConditionConfig);
  emit('cancel');
};

useOutsideInteraction({
  targets: [
    {
      isActive: isCategoryDropdownOpen,
      elements: [categoryFilterRef],
      onOutside: closeCategoryDropdown,
    },
  ],
});

useConsultationReferenceFeedbackListener<ReferenceFeedbackPayload>({
  resolveConsultationId, isActive: () => props.active !== false && currentView.value !== 'record',
  logContext: 'ConsultationPage',
  onFeedback: (payload) => {
    if (finalWriteback.consumeMutualRecognitionFeedback(payload)) return;
    applyReferenceFeedback(payload);
    finalWriteback.finalizeFeedback(payload);
  },
});

onMounted(() => {
  const restoredSnapshot = symptomCacheSession.restoreCachedSnapshot();
  if (!restoredSnapshot) {
    symptoms.value = currentTemplatesData.value;
  }
  void syncRemoteTemplates()
    .then(() => {
      if (!restoredSnapshot && selectedSymptoms.value.length === 0) {
        symptoms.value = currentTemplatesData.value;
      }
    })
    .catch((error) => {
      console.warn('[ConsultationPage] Template sync on mount failed:', error);
    });
  if (!restoredSnapshot) {
    // Initialize General Condition data
    initFormData(generalConditionConfig);
    prefillGeneratedRecordFromPatient(false);
  }

  // 预热 HIS 频次/用法/药房/执行科室字典，让后续 normalizeTreatmentRecommendation
  // 能命中 dftFreq/dftUsage 等默认值，并同步预热当前药房 scope 对应的药品目录。
  void ensureTreatmentDictionaryStateReady().catch((error) => {
    console.warn('[ConsultationPage] Failed to preload treatment dictionaries:', error);
  });
});

// 监听问诊模式变化，切换模板
watch(consultationMode, () => {
  symptoms.value = currentTemplatesData.value;
  // 清空已选症状，因为不同模板的症状可能不兼容
  clearSymptomSelection();
  initFormData(generalConditionConfig);
});

onUnmounted(() => {
  symptomCacheSession.persistSnapshot();
  symptomCacheSession.stop();
});

// Removed the automatic selectionMode switch watcher since we use v-if="!searchQuery.trim()" to hide tabs

const handleCheckboxChange = (event: Event, field: any, symptomKey: string) => {
  const target = event.target as HTMLInputElement;
  // 兼容中医和西医模板
  const fieldKey = getSymptomFieldKey(field);
  const currentValues = formData.value[symptomKey][fieldKey] || [];

  formData.value[symptomKey][fieldKey] = applyCheckboxFieldChange({
    currentValues,
    value: target.value,
    checked: target.checked,
    mutualExclusions: field.props?.mutualExclusions,
  });
};

const validationErrors = ref<Record<string, boolean>>({});

const hasFieldValidationError = (symptomKey: string, field: any): boolean => {
  const storageKey = field?.storageKey;
  const otherDetailKey = field?.props?.otherDetailKey;
  return Boolean(
    (storageKey && validationErrors.value[`${symptomKey}_${storageKey}`])
    || (otherDetailKey && validationErrors.value[`${symptomKey}_${otherDetailKey}`]),
  );
};

const shouldShowRadioOtherInput = (symptomKey: string, field: any): boolean => {
  const otherOptionLabel = field?.props?.otherOptionLabel;
  const otherDetailKey = field?.props?.otherDetailKey;
  if (!otherOptionLabel || !otherDetailKey) {
    return false;
  }

  return formData.value[symptomKey]?.[field.storageKey] === otherOptionLabel;
};

const resolveOtherDetailFieldId = (symptomKey: string, field: any): string | undefined => {
  const otherDetailKey = field?.props?.otherDetailKey;
  if (!otherDetailKey) {
    return undefined;
  }

  const hasError = validationErrors.value[`${symptomKey}_${otherDetailKey}`];
  if (!hasError) {
    return undefined;
  }

  return `field-${symptomKey}-${otherDetailKey}`;
};

// Knowledge Base Search Functions
const searchKnowledgeBaseForDiagnoses = async (diagnoses: Diagnosis[]) => {
  await searchKnowledgeByDiagnoses({
    diagnoses,
    action: 'knowledge_search_diagnoses',
  });
};

// (Unused warning suppressed: this function is prepared for future manual triggering)
// (Unused warning suppressed: this function is prepared for future manual triggering)
// @ts-ignore
const searchKnowledgeBaseForTreatment = async (medications: string[], examinations: string[]) => {
  await searchKnowledgeByTreatment({
    medications,
    examinations,
    action: 'knowledge_search_treatment',
  });
};

// @ts-ignore
const searchKnowledgeForRecommendations = async () => {
  await searchKnowledgeFromItems({
    diagnoses: aiDiagnoses.value,
    treatments: treatmentRecommendations.value,
    action: 'knowledge_search_all',
  });
};

const handleEndConsultation = async () => {
  // 防止重复提交
  if (isGenerating.value) return;
  assistFocus.value = null;

  // 1. Validation
  const validationResult = buildConsultationFormValidationResult({
    selectedSymptoms: selectedSymptoms.value,
    formData: formData.value,
    patientInfo: patientInfo.value,
    isFieldApplicable: (field, currentPatientInfo) => isFieldApplicable(field, currentPatientInfo as any),
  });
  validationErrors.value = validationResult.validationErrors;

  if (validationResult.errors.length > 0) {
    trackError('record_validation_failed', new Error(validationResult.errors.join('; ')));
    showToast("请完善以下信息：" + validationResult.errors.join("; "), "error");

    // Scroll to first error
    if (validationResult.firstErrorFieldId) {
      const element = document.getElementById(validationResult.firstErrorFieldId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    return;
  }

  // 2. Start loading
  isGenerating.value = true;

  try {
    // 3. Generation Logic
    await generateMedicalRecord();

    // 4. Switch View
    currentView.value = 'record';
    trackFormSubmit('generate_medical_record', { symptomCount: selectedSymptoms.value.length, mode: consultationMode.value });

    // 5. Trigger AI Diagnosis
    await fetchAIDiagnosis({ trackSmartConsultation: true });
  } catch (error) {
    console.error('Failed to generate medical record:', error);
    trackError('generate_medical_record_failed', error);
    showToast('生成病历失败，请稍后重试', 'error');
  } finally {
    // 6. Always clear loading state
    isGenerating.value = false;
  }
};

const parseLLMJson = (text: string): any => {
  try {
    const parsed = parseSymptomLLMJson(text);
    console.log('[parseLLMJson] Successfully parsed:', parsed);
    return parsed;
  } catch (err) {
    console.error('[parseLLMJson] Failed to parse JSON:', text, err);
    throw err;
  }
};

const buildConsultationTraceConfig = (
  operationAction: string,
  title: string,
  scene: string,
  sourceModule = 'consultation_ai',
) => ({
  traceContext: {
    scene,
    sourceModule,
    operationModule: 'consultation',
    operationAction,
    title,
  },
});

const fetchAIDiagnosis = async (options?: { trackSmartConsultation?: boolean }) => {
  const requestSeq = ++aiDiagnosisRequestSeq;
  aiLoading.value = true;
  aiError.value = null;
  try {
    const startTime = Date.now();
    console.log('========== AI 辅助诊断开始 ==========');
    console.time('[AI分析] 1. 构建提示词');
    let fullResponse = "";

    if (consultationMode.value === 'tcm') {
      // TCM Diagnosis Logic
      const tcmSignsText = buildTcmSignsPromptText(tcmInquiryConfig, formData.value['tcm_signs']);
      console.log('[TCM Debug] Collected TCM Signs:', tcmSignsText);

      const userPrompt = PROMPTS.consultation.tcmDiagnosisRecommendation.buildUserPrompt({
        patientName: patientPromptProfile.value.patientName,
        gender: patientPromptProfile.value.gender,
        age: patientPromptProfile.value.age,
        chiefComplaint: generatedRecord.value.chiefComplaint,
        historyOfPresentIllness: generatedRecord.value.historyOfPresentIllness,
        tcmSigns: tcmSignsText
      });

      console.log('[TCM Debug] User Prompt:', userPrompt);

      console.timeEnd('[AI分析] 1. 构建提示词');
      console.time('[AI分析] 2. LLM 请求 (中医)');

      fullResponse = await chat([
        {
          role: 'system',
          content: PROMPTS.consultation.tcmDiagnosisRecommendation.system
        },
        {
          role: 'user',
          content: userPrompt
        }
      ], undefined, undefined, undefined, buildConsultationTraceConfig(
        'generate_tcm_diagnosis_recommendation',
        '生成中医诊断推荐',
        'consultation-diagnosis-tcm'
      ));

      console.log('[TCM Debug] LLM Response:', fullResponse);
      console.timeEnd('[AI分析] 2. LLM 请求 (中医)');
    } else {
      // Western Medicine Logic (Existing)
      const requestSpec = buildClinicalResultDiagnosisRequestSpec({
        patientName: patientPromptProfile.value.patientName,
        gender: patientPromptProfile.value.gender,
        age: patientPromptProfile.value.age,
        chiefComplaint: generatedRecord.value.chiefComplaint,
        historyOfPresentIllness: generatedRecord.value.historyOfPresentIllness
      }, PROMPTS.consultation.diagnosisRecommendation, {
        sourceModule: 'consultation_ai',
        operationModule: 'consultation',
      }, {
        scene: 'consultation-diagnosis',
        title: '生成西医诊断推荐',
      });
      
      console.timeEnd('[AI分析] 1. 构建提示词');
      console.time('[AI分析] 2. LLM 请求 (西医)');

      fullResponse = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
      console.timeEnd('[AI分析] 2. LLM 请求 (西医)');
    }
    const latencyMs = Date.now() - startTime;

    console.time('[AI分析] 3. 解析数据和匹配标准词典');
    console.log('[TCM Debug] Parsing LLM response...');
    // Clean up response if it contains markdown code blocks
    const rawDiagnoses: Diagnosis[] = parseLLMJson(fullResponse);
    console.log('[TCM Debug] Parsed diagnoses:', rawDiagnoses);

    const diagnoses = await applyRecommendationPreferenceRanking(
      buildDiagnosisRecommendationsFromRaw({
        rawDiagnoses,
        mode: consultationMode.value === 'tcm' ? 'tcm' : 'western',
        assessDiagnosis: (query, context) => medicalDataService.assessDiagnosisMatch(query, context),
        matchTCMDiagnosis: (query) => medicalDataService.matchTCMDiagnosis(query),
        matchTCMSyndrome: (query) => medicalDataService.matchTCMSyndrome(query),
        matchTCMTreatment: (query) => medicalDataService.matchTCMTreatment(query),
      }),
      buildDiagnosisPreferenceCandidate,
      {
        consultationId: resolveConsultationId(),
        sourceModule: 'consultation_ai',
        scene: consultationMode.value === 'tcm' ? 'consultation-diagnosis-tcm' : 'consultation-diagnosis',
      },
    );

    if (requestSeq !== aiDiagnosisRequestSeq) {
      console.info('[ConsultationPage] Ignore stale diagnosis response', { requestSeq, latest: aiDiagnosisRequestSeq });
      return;
    }

    aiDiagnoses.value = diagnoses;
    selectedDiagnosis.value = null;

    console.timeEnd('[AI分析] 3. 解析数据和匹配标准词典');
    console.time('[AI分析] 4. 分支逻辑 (文献检索、持久化和事实核查)');

    // Search knowledge base for related medical literature
    searchKnowledgeBaseForDiagnoses(diagnoses);

    // Save diagnosis recommendations to database
    try {
      await registerDiagnosisRecommendationFeedbackTargets({
        recommendations: diagnoses,
        latencyMs,
        saveRecommendation: (rec) => feedbackService.saveRecommendation(rec),
        registerTarget: registerExternalRecommendationTarget,
        getRecommendationKey: getDiagnosisFeedbackKey,
        recordMetric: (metric) => feedbackService.recordMetric(metric),
        metricContext: { operation: 'diagnosis_recommendation' },
      });
    } catch (err) {
      console.error('[ConsultationPage] Failed to save diagnosis recommendations:', err);
    }

    // Perform automatic fact checking on all diagnoses
    performDiagnosisFactCheck(diagnoses);
    if (options?.trackSmartConsultation) {
      if (!smartConsultationRoundId.value) {
        smartConsultationRoundId.value = crypto.randomUUID();
      }
      submitSmartGeneratedUserLog();
    }
    
    console.timeEnd('[AI分析] 4. 分支逻辑 (文献检索、持久化和事实核查)');
    console.log(`========== AI 辅助诊断完成，总耗时: ${Date.now() - startTime}ms ==========`);
  } catch (e) {
    console.error("Failed to fetch AI diagnosis", e);
    trackError('ai_diagnosis_failed', e);
    aiError.value = "无法获取诊断建议，请稍后重试或检查网络。";
    if (aiDiagnoses.value.length > 0) {
      showToast('AI 诊断刷新失败，已保留上一版诊断建议。', 'info');
    }
  } finally {
    if (requestSeq === aiDiagnosisRequestSeq) {
      aiLoading.value = false;
    }
  }
};

const performDiagnosisFactCheck = async (diagnoses: Diagnosis[]) => {
  await runDiagnosisFactCheck<FactCheckResult, FactCheckIssue>({
    diagnoses,
    enabled: isReviewerEnabled(),
    recordText: {
      chiefComplaint: generatedRecord.value.chiefComplaint,
      historyOfPresentIllness: generatedRecord.value.historyOfPresentIllness,
      tcmFourExaminations: generatedRecord.value.tcmFourExaminations,
    },
    existingIssues: factCheckWidgetIssues.value,
    checkDiagnosis,
    checkTCMDiagnosis,
    clearResults: () => diagnosisFactChecks.value.clear(),
    setResult: (diagnosisCode, result) => diagnosisFactChecks.value.set(diagnosisCode, result),
    setWidgetChecking: (totalCount) => {
      showFactCheckWidget.value = true;
      factCheckWidgetStatus.value = 'checking';
      factCheckTotalCount.value = totalCount;
      factCheckCheckedCount.value = 0;
      factCheckProgress.value = 0;
    },
    setProgress: (checkedCount, progress) => {
      factCheckCheckedCount.value = checkedCount;
      factCheckProgress.value = progress;
    },
    setCompleted: (issues) => {
      factCheckWidgetIssues.value = issues;
      factCheckWidgetStatus.value = 'completed';
    },
    onError: (diagnosis, error) => {
      console.error(`Failed to fact check diagnosis: ${diagnosis.name}`, error);
    },
  });
};

const performTreatmentFactCheck = async (treatments: TreatmentRecommendation[]) => {
  await runTreatmentFactCheck<FactCheckResult, FactCheckIssue>({
    treatments,
    enabled: isReviewerEnabled(),
    mode: consultationMode.value === 'tcm' ? 'tcm' : 'western',
    diagnosisName: selectedDiagnosis.value?.name,
    checkMedicine,
    checkTCMMedicine,
    checkExamination,
    clearResults: () => {
      treatmentFactChecks.value.clear();
      factCheckWidgetIssues.value = [];
    },
    setResult: (treatmentName, result) => treatmentFactChecks.value.set(treatmentName, result),
    setWidgetChecking: (totalCount) => {
      showFactCheckWidget.value = true;
      factCheckWidgetStatus.value = 'checking';
      factCheckTotalCount.value = totalCount;
      factCheckCheckedCount.value = 0;
      factCheckProgress.value = 0;
    },
    setProgress: (checkedCount, progress) => {
      factCheckCheckedCount.value = checkedCount;
      factCheckProgress.value = progress;
    },
    setCompleted: (issues) => {
      factCheckWidgetIssues.value = issues;
      factCheckWidgetStatus.value = 'completed';
    },
    onError: (treatment, error) => {
      console.error(`Failed to fact check treatment: ${treatment.name}`, error);
    },
  });
};

const getTreatmentRecommendationContext = () => buildConsultationTreatmentRecommendationContext({
  patient: patientPromptProfile.value,
  diagnosis: selectedDiagnosis.value!,
  record: generatedRecord.value,
});

const fetchTreatmentRecommendation = async () => {
  if (!selectedDiagnosis.value) return;
  const requestSeq = ++treatmentRecommendationRequestSeq;
  const diagnosisIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  treatmentLoading.value = true;
  treatmentError.value = null;
  try {
    const startTime = Date.now(), inventoryContext = await loadAvailableMedicineInventoryContext({ pharmacies: hisPharmacyOptions.value });
    let fullResponse = "";
    if (consultationMode.value === 'tcm') {
      const userPrompt = PROMPTS.consultation.tcmTreatmentRecommendation.buildUserPrompt({
        patientName: patientPromptProfile.value.patientName,
        gender: patientPromptProfile.value.gender,
        age: patientPromptProfile.value.age,
        diagnosisName: selectedDiagnosis.value.name,
        chiefComplaint: generatedRecord.value.chiefComplaint, availableMedicineInventory: inventoryContext.promptContext,
      });

      fullResponse = await chat([
        { role: 'system', content: PROMPTS.consultation.tcmTreatmentRecommendation.system },
        { role: 'user', content: userPrompt }
      ], undefined, undefined, undefined, buildConsultationTraceConfig(
        'generate_tcm_treatment_recommendation',
        '生成中医治疗推荐',
        'consultation-treatment-tcm'
      ));
    } else {
      const requestSpec = buildClinicalResultTreatmentRequestSpec('medication', {
        ...getTreatmentRecommendationContext(),
        availableMedicineInventory: inventoryContext.promptContext,
      }, PROMPTS.consultation.treatmentRecommendation, {
        sourceModule: 'consultation_ai', operationModule: 'consultation',
      }, {
        scene: 'consultation-treatment-medication',
        title: '生成用药推荐',
      });

      fullResponse = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
    }
    const latencyMs = Date.now() - startTime;
    const rawRecommendations: any[] = alignMedicineRecommendationsToInventory(parseLLMJson(fullResponse), inventoryContext.items);

    let processedRecs = buildClinicalResultTreatmentRecommendationsFromRaw({
      rawRecommendations,
      type: 'medicine',
      match: assessTreatmentCatalogMatch,
      normalize: normalizeTreatmentRecommendation,
    });
    processedRecs = await applyTreatmentPreferenceRanking(processedRecs, 'consultation-treatment-medication');

    if (isStaleRecommendationContext({
      requestSeq,
      latestRequestSeq: treatmentRecommendationRequestSeq,
      expectedDiagnosisIdentity: diagnosisIdentity,
      currentDiagnosis: selectedDiagnosis.value,
    })) {
      console.info('[ConsultationPage] Ignore stale medication response', {
        requestSeq,
        latest: treatmentRecommendationRequestSeq,
        diagnosisIdentity,
        currentDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
      });
      return;
    }

    treatmentRecommendations.value = processedRecs;

    try {
      await registerTreatmentRecommendationFeedbackTargets({
        recommendations: processedRecs,
        recType: 'medication',
        targetType: 'medication',
        latencyMs,
        saveRecommendation: (rec) => feedbackService.saveRecommendation(rec),
        registerTarget: registerExternalRecommendationTarget,
        getRecommendationKey: getTreatmentFeedbackKey,
        recordMetric: (metric) => feedbackService.recordMetric(metric),
        metricContext: { operation: 'treatment_recommendation' },
      });
    } catch (err) {
      console.error('[ConsultationPage] Failed to save medication recommendations:', err);
    }

    performTreatmentFactCheck(processedRecs);
  } catch (e) {
    console.error("Failed to fetch medication recommendations", e);
    trackError('treatment_recommendation_failed', e);
    treatmentError.value = "无法获取用药方案建议。";
    if (treatmentRecommendations.value.length > 0) {
      showToast('用药方案刷新失败，已保留上一版建议。', 'info');
    }
  } finally {
    if (requestSeq === treatmentRecommendationRequestSeq) {
      treatmentLoading.value = false;
    }
  }
};

const fetchExamRecommendation = async () => {
  if (!selectedDiagnosis.value || consultationMode.value === 'tcm') return;

  const requestSeq = ++examRecommendationRequestSeq;
  const diagnosisIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  examLoading.value = true;
  examError.value = null;

  try {
    const startTime = Date.now();
    const requestSpec = buildClinicalResultTreatmentRequestSpec(
      'exam', getTreatmentRecommendationContext(), PROMPTS.consultation.examinationRecommendation, {
      sourceModule: 'consultation_ai',
      operationModule: 'consultation',
    }, {
      scene: 'consultation-treatment-examination',
      title: '生成检查推荐',
    });

    const fullResponse = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
    const latencyMs = Date.now() - startTime;
    const rawRecommendations: any[] = parseLLMJson(fullResponse);
    console.log('[检查推荐] LLM raw count:', rawRecommendations.length, rawRecommendations.map(r => ({ name: r.name, type: r.type })));

    let processedRecs = buildClinicalResultTreatmentRecommendationsFromRaw({
      rawRecommendations,
      type: 'exam',
      match: assessTreatmentCatalogMatch,
      normalize: normalizeTreatmentRecommendation,
    });
    processedRecs = await applyTreatmentPreferenceRanking(processedRecs, 'consultation-treatment-examination');

    if (isStaleRecommendationContext({
      requestSeq,
      latestRequestSeq: examRecommendationRequestSeq,
      expectedDiagnosisIdentity: diagnosisIdentity,
      currentDiagnosis: selectedDiagnosis.value,
    })) {
      console.info('[ConsultationPage] Ignore stale examination response', {
        requestSeq,
        latest: examRecommendationRequestSeq,
        diagnosisIdentity,
        currentDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
      });
      return;
    }

    examRecommendations.value = processedRecs;
    void treatmentHydration.hydrateMatchedMedicalItemDetails(processedRecs);

    try {
      await registerTreatmentRecommendationFeedbackTargets({
        recommendations: processedRecs,
        recType: 'examination',
        targetType: 'examination',
        latencyMs,
        saveRecommendation: (rec) => feedbackService.saveRecommendation(rec),
        registerTarget: registerExternalRecommendationTarget,
        getRecommendationKey: getTreatmentFeedbackKey,
      });
    } catch (err) {
      console.error('[ConsultationPage] Failed to save exam recommendations:', err);
    }
  } catch (e) {
    console.error("Failed to fetch exam recommendations", e);
    examError.value = "无法获取检查推荐。";
    if (examRecommendations.value.length > 0) {
      showToast('检查推荐刷新失败，已保留上一版建议。', 'info');
    }
  } finally {
    if (requestSeq === examRecommendationRequestSeq) {
      examLoading.value = false;
    }
  }
};

const fetchLabTestRecommendation = async () => {
  if (!selectedDiagnosis.value || consultationMode.value === 'tcm') return;

  const requestSeq = ++labTestRecommendationRequestSeq;
  const diagnosisIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  labTestLoading.value = true;
  labTestError.value = null;

  try {
    const startTime = Date.now();
    const requestSpec = buildClinicalResultTreatmentRequestSpec(
      'lab_test', getTreatmentRecommendationContext(), PROMPTS.consultation.labTestRecommendation, {
      sourceModule: 'consultation_ai',
      operationModule: 'consultation',
    }, {
      scene: 'consultation-treatment-lab-test',
      title: '生成检验推荐',
    });

    const fullResponse = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
    const latencyMs = Date.now() - startTime;
    const rawRecommendations: any[] = parseLLMJson(fullResponse);
    console.log('[检验推荐] LLM raw count:', rawRecommendations.length, rawRecommendations.map(r => ({ name: r.name, type: r.type })));

    let processedRecs = buildClinicalResultTreatmentRecommendationsFromRaw({
      rawRecommendations,
      type: 'lab_test',
      match: assessTreatmentCatalogMatch,
      normalize: normalizeTreatmentRecommendation,
    });
    processedRecs = await applyTreatmentPreferenceRanking(processedRecs, 'consultation-treatment-lab-test');

    if (isStaleRecommendationContext({
      requestSeq,
      latestRequestSeq: labTestRecommendationRequestSeq,
      expectedDiagnosisIdentity: diagnosisIdentity,
      currentDiagnosis: selectedDiagnosis.value,
    })) {
      console.info('[ConsultationPage] Ignore stale lab test response', {
        requestSeq,
        latest: labTestRecommendationRequestSeq,
        diagnosisIdentity,
        currentDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
      });
      return;
    }

    labTestRecommendations.value = processedRecs;
    void treatmentHydration.hydrateMatchedMedicalItemDetails(processedRecs);

    try {
      await registerTreatmentRecommendationFeedbackTargets({
        recommendations: processedRecs,
        recType: 'lab_test',
        targetType: 'lab_test',
        latencyMs,
        saveRecommendation: (rec) => feedbackService.saveRecommendation(rec),
        registerTarget: registerExternalRecommendationTarget,
        getRecommendationKey: getTreatmentFeedbackKey,
      });
    } catch (err) {
      console.error('[ConsultationPage] Failed to save lab test recommendations:', err);
    }
  } catch (e) {
    console.error("Failed to fetch lab test recommendations", e);
    labTestError.value = "无法获取检验推荐。";
    if (labTestRecommendations.value.length > 0) {
      showToast('检验推荐刷新失败，已保留上一版建议。', 'info');
    }
  } finally {
    if (requestSeq === labTestRecommendationRequestSeq) {
      labTestLoading.value = false;
    }
  }
};

const fetchProcedureRecommendation = async () => {
  if (!selectedDiagnosis.value || consultationMode.value === 'tcm') return;

  const requestSeq = ++procedureRecommendationRequestSeq;
  const diagnosisIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  procedureLoading.value = true;
  procedureError.value = null;

  try {
    const startTime = Date.now();
    const requestSpec = buildClinicalResultTreatmentRequestSpec(
      'procedure', getTreatmentRecommendationContext(), PROMPTS.consultation.procedureRecommendation, {
      sourceModule: 'consultation_ai',
      operationModule: 'consultation',
    }, {
      scene: 'consultation-treatment-procedure',
      title: '生成处置推荐',
    });

    const fullResponse = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
    const latencyMs = Date.now() - startTime;
    const rawRecommendations: any[] = parseLLMJson(fullResponse);
    console.log('[处置推荐] LLM raw count:', rawRecommendations.length, rawRecommendations.map(r => ({ name: r.name, type: r.type })));
    
    let processedRecs = buildClinicalResultTreatmentRecommendationsFromRaw({
      rawRecommendations,
      type: 'procedure',
      match: assessTreatmentCatalogMatch,
      normalize: normalizeTreatmentRecommendation,
    });
    processedRecs = await applyTreatmentPreferenceRanking(processedRecs, 'consultation-treatment-procedure');

    if (isStaleRecommendationContext({
      requestSeq,
      latestRequestSeq: procedureRecommendationRequestSeq,
      expectedDiagnosisIdentity: diagnosisIdentity,
      currentDiagnosis: selectedDiagnosis.value,
    })) {
      console.info('[ConsultationPage] Ignore stale procedure response', {
        requestSeq,
        latest: procedureRecommendationRequestSeq,
        diagnosisIdentity,
        currentDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
      });
      return;
    }

    procedureRecommendations.value = processedRecs;
    void treatmentHydration.hydrateMatchedMedicalItemDetails(processedRecs);

    try {
      await registerTreatmentRecommendationFeedbackTargets({
        recommendations: processedRecs,
        recType: 'procedure',
        targetType: 'procedure',
        latencyMs,
        saveRecommendation: (rec) => feedbackService.saveRecommendation(rec),
        registerTarget: registerExternalRecommendationTarget,
        getRecommendationKey: getTreatmentFeedbackKey,
      });
    } catch (err) {
      console.error('[ConsultationPage] Failed to save procedure recommendations:', err);
    }
  } catch (e) {
    console.error("Failed to fetch procedure recommendations", e);
    procedureError.value = "无法获取处置推荐。";
    if (procedureRecommendations.value.length > 0) {
      showToast('处置推荐刷新失败，已保留上一版建议。', 'info');
    }
  } finally {
    if (requestSeq === procedureRecommendationRequestSeq) {
      procedureLoading.value = false;
    }
  }
};

/** 并行触发所有四路推荐 */
const fetchAllRecommendations = async () => {
  await ensureTreatmentDictionaryStateReady();
  await Promise.all([
    fetchTreatmentRecommendation(),
    fetchExamRecommendation(),
    fetchLabTestRecommendation(),
    fetchProcedureRecommendation(),
  ]);
  syncTreatmentExecDeptSelections();
};

const consultationAssistController = useConsultationAssistController({
  assistFocus,
  aiDiagnoses,
  selectedDiagnosis,
  aiLoading,
  treatmentLoading,
  treatmentRecommendations,
  examLoading,
  examRecommendations,
  labTestLoading,
  labTestRecommendations,
  procedureLoading,
  procedureRecommendations,
  hasRecordDraft: () => hasRecordDraft.value,
  prefillRecord: prefillGeneratedRecordFromPatient,
  prefillDiagnosis: prefillDiagnosisFromPatient,
  setCurrentView: (view) => {
    currentView.value = view;
  },
  notify: (message, level) => showToast(message, level || 'info'),
  afterContextReady: () => nextTick(),
  fetchAIDiagnosis: () => fetchAIDiagnosis(),
  fetchTreatmentRecommendation,
  fetchExamRecommendation,
  fetchLabTestRecommendation,
  fetchProcedureRecommendation,
  consumeAutoTrigger: () => emit('consume-auto-trigger'),
});

const handleAssistTrigger = (kind: AssistAction): Promise<void> =>
  consultationAssistController.triggerAssist(kind);

// @ts-ignore: kept for future use (currently commented out in template)
const _handleComplete = () => {
  if (!selectedDiagnosis.value) {
    showToast("请先选择一个诊断结果", "info");
    return;
  }

  const treatmentGroups = [
    treatmentRecommendations.value,
    examRecommendations.value,
    labTestRecommendations.value,
    procedureRecommendations.value,
  ];
  const selectedTreatments = buildSelectedTreatmentSnapshots(treatmentGroups);

  trackConsultationCompletion({
    selectedDiagnosis: selectedDiagnosis.value,
    diagnoses: aiDiagnoses.value,
    medicines: treatmentRecommendations.value,
    selectedTreatmentCount: selectedTreatments.length,
    mode: consultationMode.value === 'tcm' ? 'tcm' : 'western',
    getDiagnosisIdentity,
    trackRecommendationAction: ({ targetType, targetId, action, options }) => {
      trackRecommendationAction(targetType, targetId, action, options);
    },
    trackFormSubmit: ({ name, details }) => {
      trackFormSubmit(name, details);
    },
  });

  const medicalAdvice = buildMedicalAdvice({
    mode: consultationMode.value === 'tcm' ? 'tcm' : 'western',
    hasHerbalMedicine: treatmentRecommendations.value.some(t => t.selected && t.ingredients),
  });

  finalRecord.value = buildFinalRecord({
    patient: patientInfo.value,
    generatedRecord: generatedRecord.value,
    diagnosis: selectedDiagnosis.value,
    treatmentGroups,
    mode: consultationMode.value === 'tcm' ? 'tcm' : 'western',
    medicalAdvice,
    date: new Date().toLocaleDateString(),
  });

  currentView.value = 'final_report';
};

watch(selectedDiagnosis, (newVal) => {
  if (newVal) {
    fetchAllRecommendations();
  } else {
    invalidateRecommendationRequests();
    resetTreatmentRecommendationState();
  }
});

watch(consultationMode, (newVal, oldVal) => {
  trackClick('consultation_mode_change', { from: oldVal, to: newVal });
});

watch(selectionMode, (newVal) => {
  trackClick('symptom_selection_mode', { mode: newVal });
});

watch(currentView, (newVal, oldVal) => {
  trackViewChange(`consultation:${oldVal}`, `consultation:${newVal}`);
});

watch(
  () => props.assistTrigger?.token,
  async (token) => {
    if (!token || !props.assistTrigger) {
      return;
    }

    await handleAssistTrigger(props.assistTrigger.kind);
  },
  { immediate: true }
);

const generateMedicalRecord = async () => {
  generatedRecord.value = await recordDraftGeneration.generateRecordDraft();
};

</script>

<style scoped src="../features/symptom-consultation/ui/ConsultationPage.css"></style>
