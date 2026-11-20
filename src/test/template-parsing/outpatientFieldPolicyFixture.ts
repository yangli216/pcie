import { resolveOutpatientEmrUnmentionedDefault } from '@features/outpatient-emr/lib/outpatientEmrPromptGenerator';
import type { PersistOutpatientEmrTemplateSnapshotInput, OutpatientEmrTemplateSnapshotReceipt } from '@features/outpatient-emr/api/outpatientEmrTemplateSnapshotService';
import type { OutpatientEmrTemplateField, OutpatientFieldPolicy } from '@features/outpatient-emr/types';

export function syntheticFieldPolicy(fields: OutpatientEmrTemplateField[]): OutpatientFieldPolicy {
  return { schemaVersion: 'outpatient-emr-field-policy.v1', templateState: 'enabled', revision: 0, ruleSetVersion: 'outpatient-emr-field-prompt.v5',
    fields: fields.map(f => {
      const ai = !f.readonly && !/页眉|页脚|签名|^就诊时间$/.test(f.name);
      return { fieldId: f.id, meaning: f.name, aiSuitable: ai, generationSource: ai ? 'default' : 'protected',
        promptSource: ai ? 'default' : 'not_ai', resolvedPrompt: ai ? '依据资料填写' + f.name : null,
        unmentionedDefault: ai ? resolveOutpatientEmrUnmentionedDefault(f) ?? null : null };
    }) };
}

export function syntheticReceipt(input: PersistOutpatientEmrTemplateSnapshotInput): OutpatientEmrTemplateSnapshotReceipt {
  return { schemaVersion: 'outpatient-emr-template-pair-receipt.v2', id: 'SYN-SNAPSHOT', deduplicated: false,
    receivedAt: 1, templateId: input.request.templateId, templateHash: input.templateHash,
    parseResult: { schemaVersion: 'outpatient-emr-template-pair.v1', fields: input.template.fields },
    fieldPolicy: syntheticFieldPolicy(input.template.fields) };
}
