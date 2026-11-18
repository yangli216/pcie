# Prompts 管理系统

## 概述

所有 LLM Prompts 现已集中管理在 `src/prompts/` 目录中，避免了之前散布在各个组件中的混乱状态。

## 目录结构

```
src/prompts/
├── index.ts          # 统一导出入口（向后兼容）
├── prompts.ts        # 所有 prompts 的实际定义 ⭐
└── README.md         # 本文档
```

**主要文件**：
- **prompts.ts** - 所有 prompts 的集中定义（修改 prompts 请编辑这个文件）
- **index.ts** - 重新导出 prompts.ts 的内容，提供统一导入接口

## 使用方法

### 1. 导入 Prompts

```typescript
import { PROMPTS } from '../prompts';
```

### 2. 使用示例

#### 医疗记录生成（语音问诊）

```typescript
const messages: ChatMessage[] = [
  {
    role: 'system',
    content: PROMPTS.consultation.medicalRecordGeneration.system
  },
  {
    role: 'user',
    content: PROMPTS.consultation.medicalRecordGeneration.buildUserPrompt(transcribedText)
  }
];

const response = await chat(messages);
```

#### 患者风险分析

```typescript
const messages: ChatMessage[] = [
  {
    role: 'system',
    content: PROMPTS.consultation.patientRiskAnalysis.system
  },
  {
    role: 'user',
    content: PROMPTS.consultation.patientRiskAnalysis.buildUserPrompt({
      patientName: '张三',
      gender: '男',
      age: '45岁',
      chiefComplaint: '胸痛3小时',
      // ... 其他字段
    })
  }
];

const risks = await analyzePatientRisks(patientData);
```

#### 诊断推荐

```typescript
const messages: ChatMessage[] = [
  {
    role: 'system',
    content: PROMPTS.consultation.diagnosisRecommendation.system
  },
  {
    role: 'user',
    content: PROMPTS.consultation.diagnosisRecommendation.buildUserPrompt({
      patientName: '张三',
      gender: '男',
      age: '45岁',
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '患者3天前无明显诱因出现咳嗽...'
    })
  }
];
```

#### 治疗方案推荐

```typescript
const messages: ChatMessage[] = [
  {
    role: 'system',
    content: PROMPTS.consultation.treatmentRecommendation.system
  },
  {
    role: 'user',
    content: PROMPTS.consultation.treatmentRecommendation.buildUserPrompt({
      patientName: '张三',
      gender: '男',
      age: '45岁',
      diagnosisName: '急性上呼吸道感染',
      diagnosisCode: 'J06.900',
      chiefComplaint: '咳嗽3天'
    })
  }
];
```

#### 聊天助手

```typescript
const messages = ref<ChatMessage[]>([
  { role: "system", content: PROMPTS.chat.defaultSystem },
  { role: "assistant", content: PROMPTS.chat.welcomeMessage }
]);
```

## Prompt 分类

### Medical（医疗相关）

#### `recordGeneration` - 医疗记录生成
- **用途**: 将语音转录文本转换为结构化病历
- **输入**: 医患对话文本
- **输出**: JSON 格式的结构化病历（主诉、现病史、诊断、用药、检查等）
- **特点**:
  - 语义过滤（区分问诊话术与病情描述）
  - 细粒度拆分（"A+B" → 两个独立项目）
  - 智能推荐补全

#### `riskAnalysis` - 患者风险分析
- **用途**: 分析患者潜在健康风险
- **输入**: 患者基本信息 + 病史
- **输出**: 风险清单（level, category, content）
- **风险类别**: allergy, chronic, medication, population, vital, other
- **特点**: 严格区分当前就诊与历史记录

### Consultation（问诊辅助）

#### `voiceIntentRecognitionStream` - 语音渐进意图识别
- **用途**: 将录音转写文本在同一次请求中整理为病例草稿、AI 病历候选、诊断提示、明确医嘱和诊疗路由，供结果页渐进应用
- **输入**: 医患对话转写文本
- **输出**: 按固定顺序逐行返回的 NDJSON 分区事件
- **特点**:
  - 使用独立版本化编码，避免历史 `voiceIntentRecognition` 纯 JSON override 覆盖新协议
  - 普通语音绑定 HIS 门诊模板时，在同一条流中按源章节 ID 追加 `template_chapter` 事件，同一事件的 `data.text` 和 `data.fieldValues` 同时提供本章正文和本章原始可写字段 ID／值。兼容读取 `record_extra.data.templateFieldValues`。
  - `record_suggestions` 与核心病历同次返回，缺失时客户端才走一次稳定态兜底
  - 区分对话明确表达的信息与模型推断结果（`explicit` / `inferred`）
  - `explicit_orders` 只承载医生明确医嘱；AI 治疗推荐继续由实时院内目录与药品定稿链路生成

#### `voiceIntentRepair` - 语音抽取结果修复
- **用途**: 当 `voiceIntentRecognition` 首次输出不是合法 JSON 或缺少关键结构时，将原始输出修复为符合约定结构的 JSON
- **输入**: 医患对话原文 + 首次模型输出 + 校验失败原因
- **输出**: 修复后的 JSON 字符串
- **特点**:
  - 只做结构修复，不改变原始医疗语义方向
  - 用于降低模型输出格式漂移导致的语音链路失败率

#### `diagnosisRecommendation` - 诊断推荐
- **用途**: 根据症状推荐 ICD10 诊断
- **输入**: 患者信息 + 主诉 + 现病史
- **输出**: 3个诊断建议（code, name, rate, rationale）

#### `treatmentRecommendation` - 治疗方案推荐
- **用途**: 根据诊断推荐用药和检查
- **输入**: 患者信息 + 已选诊断
- **输出**: 3-5个药品 + 1-2个检查项目

### Chat（通用聊天）

#### `defaultSystem` - 默认系统 Prompt
- **用途**: 定义聊天助手的角色和风格
- **内容**: "你是一个专业的医疗助手，回答请专业、准确、亲切。"

#### `welcomeMessage` - 欢迎消息
- **用途**: 聊天界面的初始问候语
- **内容**: "您好，我是全医慧助，请问有什么可以帮您？"

## Prompt 版本管理

每个 Prompt 都有版本号，便于追踪和 A/B 测试；完整版本表以 `src/prompts/prompts.ts` 里的 `PROMPT_VERSION` 为准：

```typescript
export const PROMPT_VERSION = {
  voiceIntentRecognition: 'v3.0',
  voiceIntentRecognitionStream: 'v1.0',
  treatmentRecommendation: 'v2.1',
  procedureRecommendation: 'v1.1',
  chatAssistant: 'v1.0',
  // ...
};
```

## 修改 Prompt

### 1. 修改现有 Prompt

直接编辑 `src/prompts/prompts.ts` 文件中的对应 Prompt：

```typescript
export const MedicalRecordGenerationPrompt = {
  system: `你是一名专业的医疗病历生成助手...`, // 修改这里

  buildUserPrompt(transcribedText: string): string {
    return `医患对话内容：\n${transcribedText}`; // 或修改这里
  }
};
```

### 2. 添加新 Prompt

在 `src/prompts/prompts.ts` 中添加新的 Prompt 对象：

```typescript
export const NewFeaturePrompt = {
  system: '系统 Prompt 内容...',

  buildUserPrompt(params: { /* 参数类型 */ }): string {
    return `用户 Prompt 模板...`;
  }
};

// 添加到统一导出
export const PROMPTS = {
  medical: { ... },
  consultation: { ... },
  chat: { ... },
  newFeature: NewFeaturePrompt,  // 新增
  version: PROMPT_VERSION
};
```

### 3. 更新版本号

修改 Prompt 后，记得更新版本号：

```typescript
export const PROMPT_VERSION = {
  medicalRecordGeneration: 'v1.1',  // 从 v1.0 更新到 v1.1
  // ...
};
```

## 最佳实践

### 1. Prompt 设计原则

- ✅ 使用明确的角色定义（"你是一名..."）
- ✅ 提供具体的输出格式要求（JSON Schema）
- ✅ 添加边界情况处理（如"非医疗内容"过滤）
- ✅ 使用细粒度规则（如"拆分 A+B"）
- ✅ 明确禁止项（"严禁包含..."）

### 2. 参数化 Prompt

使用函数构建动态 Prompt，支持参数替换：

```typescript
buildUserPrompt(params: { name: string, age: string }): string {
  return `患者姓名：${params.name}，年龄：${params.age}`;
}
```

### 3. 类型安全

为参数定义明确的类型：

```typescript
buildUserPrompt(params: {
  patientName: string;
  gender: string;
  age: string;
  chiefComplaint: string;
  historyOfPresentIllness: string;
}): string {
  // ...
}
```

### 4. 分离关注点

- **System Prompt**: 定义 AI 角色、能力和规则
- **User Prompt**: 提供具体数据和任务描述
- **Builder Function**: 动态构建 User Prompt

## A/B 测试

要进行 A/B 测试，可以创建多个版本的 Prompt：

```typescript
export const MedicalRecordGenerationPromptV2 = {
  system: `改进版的系统 Prompt...`,
  // ...
};

// 使用时切换
const prompt = useV2
  ? PROMPTS.consultation.medicalRecordGenerationV2
  : PROMPTS.consultation.medicalRecordGeneration;
```

## 迁移记录

### 迁移前（散布在各处）

- ❌ `App.vue:286-325` - 医疗记录生成
- ❌ `llm.ts:296-320` - 风险分析
- ❌ `ConsultationPage.vue:938-962` - 诊断推荐
- ❌ `ConsultationPage.vue:1068-1086` - 治疗推荐
- ❌ `ChatPanel.vue:31-32` - 聊天助手

### 迁移后（集中管理）

- ✅ `src/prompts/prompts.ts` - 所有 prompts 统一定义
- ✅ `src/prompts/index.ts` - 统一导出入口
- ✅ 各组件通过 `import { PROMPTS } from '../prompts'` 使用

## 优势总结

### 1. 可维护性
- 所有 Prompts 在一个文件中，易于查找和修改
- 避免了散布在代码各处导致的维护困难

### 2. 一致性
- 统一的 Prompt 格式和风格
- 便于团队协作和代码审查

### 3. 可测试性
- Prompts 独立于业务逻辑，易于单独测试
- 支持 A/B 测试和版本对比

### 4. 版本控制
- 清晰的版本号管理
- 便于追踪 Prompt 变更历史

### 5. 类型安全
- TypeScript 类型检查
- 减少参数错误

## 相关文件

- `src/prompts/prompts.ts` - Prompts 定义
- `src/prompts/index.ts` - 统一导出入口
- `src/App.vue` - 使用医疗记录生成 Prompt
- `src/services/llm.ts` - 使用风险分析 Prompt
- `src/components/ConsultationPage.vue` - 使用诊断和治疗推荐 Prompts
- `src/components/ChatPanel.vue` - 使用聊天助手 Prompts
