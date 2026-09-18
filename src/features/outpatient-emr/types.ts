import type {
  RecordConfirmedWritebackField,
  RecordConfirmedWritebackScope,
} from '@features/clinical-result';

export interface OutpatientEmrPatientInput {
  idPi?: string;
  name?: string;
  sdSexText?: string;
  ageText?: string;
}

export interface VoiceOutpatientEmrTemplateInput {
  templateId: string;
  templateName: string;
  templateHtml: string;
  templateDefinition: string;
  targetFieldIds: string[];
  requestId: string;
}

export interface VoiceOutpatientEmrStartContext {
  visitId: string;
  template: VoiceOutpatientEmrTemplateInput;
}

export type OutpatientEmrRecordContext = Record<string, unknown>;

export interface OutpatientEmrAnalysisRequest {
  visitId: string;
  templateId: string;
  templateName: string;
  templateHtml: string;
  templateDefinition: string;
  targetFieldIds: string[];
  recordContext: OutpatientEmrRecordContext;
  patient?: OutpatientEmrPatientInput;
  requestId: string;
}

export type OutpatientEmrRecordField = RecordConfirmedWritebackField;

export type OutpatientEmrProjectionMode = 'direct' | 'section-compose';

export interface OutpatientEmrDictionaryItem {
  value: string;
  text: string;
}

export type OutpatientEmrFieldMappingSource =
  | 'definition-record-field'
  | 'definition-article-record-field'
  | 'canonical-id'
  | 'deterministic-alias'
  | 'deterministic-article'
  | 'unmapped';

export interface OutpatientEmrTemplateField {
  id: string;
  name: string;
  type: string;
  articleTemplateId: string;
  articleId: string;
  articleName: string;
  articleDefinitionName: string;
  readonly: boolean;
  aiSuitable: boolean;
  baselineValue: string;
  baselineDictionaryValue: string;
  dictionaryItems: OutpatientEmrDictionaryItem[];
  recordField: OutpatientEmrRecordField | null;
  mappingSource: OutpatientEmrFieldMappingSource;
  projectionMode: OutpatientEmrProjectionMode | null;
}

export interface OutpatientEmrTemplateInspectionResult {
  sanitizedHtml: string;
  fields: OutpatientEmrTemplateField[];
}

export interface OutpatientEmrTemplateParseResult
  extends OutpatientEmrTemplateInspectionResult {
  targetFields: OutpatientEmrTemplateField[];
}

export type OutpatientEmrErrorCode =
  | 'INVALID_TEMPLATE_JSON'
  | 'TEMPLATE_PAIR_MISMATCH'
  | 'INVALID_DICTIONARY_DEFINITION'
  | 'MISSING_DICTIONARY_DEFINITION'
  | 'INVALID_DICTIONARY_VALUE'
  | 'DUPLICATE_TEMPLATE_FIELD'
  | 'INVALID_RECORD_FIELD_MAPPING'
  | 'DUPLICATE_RECORD_FIELD_MAPPING'
  | 'INVALID_TARGET_FIELD_IDS'
  | 'NO_SUPPORTED_TEMPLATE_FIELDS'
  | 'INVALID_RECORD_CONTEXT'
  | 'REQUEST_ID_CONFLICT'
  | 'TEMPLATE_SNAPSHOT_FAILED'
  | 'ANALYSIS_FAILED'
  | 'WRITEBACK_FAILED';

export type OutpatientEmrAnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'error';
export type OutpatientEmrWritebackStatus =
  | 'idle'
  | 'submitting'
  | 'pending'
  | 'success'
  | 'failed';

export interface OutpatientEmrTemplateMetadata {
  schemaVersion: 'outpatient-emr-template-pair.v1';
  templateId: string;
  templateName: string;
  templateHash: string;
  fields: Array<Pick<
    OutpatientEmrTemplateField,
    | 'id'
    | 'name'
    | 'type'
    | 'articleTemplateId'
    | 'articleId'
    | 'articleName'
    | 'articleDefinitionName'
    | 'dictionaryItems'
    | 'recordField'
    | 'mappingSource'
    | 'projectionMode'
  >>;
}

export type OutpatientEmrProjectedRecord = {
  schemaVersion: 'outpatient-record.v1';
} & Partial<Record<OutpatientEmrRecordField, string>>;

export interface OutpatientEmrPreparedWritebackPayload extends Record<string, unknown> {
  consultationId: string;
  timestamp: number;
  resultType: 'record-confirmed';
  requestId: string;
  referenceType: 'batch';
  action: 'batch';
  referenceStatus: 'pending';
  referenceMessage: string;
  outpatientRecord?: OutpatientEmrProjectedRecord;
  diagList?: Array<Record<string, string>>;
  writebackScope: RecordConfirmedWritebackScope;
  orderList: Array<Record<string, string | number>>;
  treatmentPlan?: string;
  emrFieldValues?: Record<string, string>;
}

export interface OutpatientEmrRecordConfirmedPayload
  extends OutpatientEmrPreparedWritebackPayload {
  visitId: string;
  emrType: 'outpatient-emr';
  templateMetadata: OutpatientEmrTemplateMetadata;
  fieldValues: Record<string, string>;
  dictionarySelections: Record<string, OutpatientEmrDictionaryItem>;
  emrFieldValues: Record<string, string>;
}

export interface OutpatientEmrCancelledPayload {
  consultationId: string;
  visitId: string;
  timestamp: number;
  requestId: string;
  resultType: 'cancelled';
  status: 'cancelled';
  emrType: 'outpatient-emr';
}

export interface OutpatientEmrReferenceFeedbackPayload {
  consultationId: string;
  requestId: string;
  status: 'pending' | 'success' | 'failed';
  message?: string;
}
