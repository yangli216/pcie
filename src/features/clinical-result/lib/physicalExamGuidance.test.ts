import { describe, expect, it } from 'vitest';
import { completePhysicalExamSuggestions, canAppendPhysicalExamCandidate } from './physicalExamGuidance';
import { mergeClinicalRecordSuggestionIntoText, stripUnverifiedPhysicalExam } from '../clinicalRecordAnnotation';
import { normalizeClinicalRecordFactSuggestions, type ClinicalRecordFactRecord, type ClinicalRecordFactSuggestion } from '../clinicalRecordFactConfirmation';
import { buildOutpatientRecord } from '../outpatientRecord';
import { collectPhysicalExamVitalSigns } from '../physicalExamVitalTemplate';

const record = (patch: Partial<ClinicalRecordFactRecord> = {}): ClinicalRecordFactRecord => ({
  chiefComplaint: '', historyOfPresentIllness: '', pastMedicalHistory: '', personalHistory: '', familyHistory: '', physicalExam: '', ...patch,
});
const suggestion = (text: string): ClinicalRecordFactSuggestion => ({
  id: text, field: 'physicalExam', negativeRecordText: text, question: `核对${text}`, rationale: '本次相关', priority: 'critical', status: 'pending',
});

describe('case-related physical examination', () => {
  it.each([
    ['咳嗽发热', '双肺呼吸音粗', '腹部无压痛'],
    ['高血压复诊', '心律齐', '双足背动脉搏动可触及'],
    ['糖尿病复诊', '双足背动脉搏动可触及', '扁桃体无肿大'],
    ['腹痛', '腹部无压痛', '双肺呼吸音粗'],
    ['头晕', '四肢肌力正常', '腹部无压痛'],
  ])('selects related modules for %s', (complaint, included, excluded) => {
    const output = completePhysicalExamSuggestions(record({ chiefComplaint: complaint }), [], []);
    const text = output.map((item) => item.negativeRecordText).join('；');
    expect(text).toContain(included); expect(text).not.toContain(excluded);
    expect(output.every((item) => item.status === 'pending')).toBe(true);
  });

  it('does not turn unselected historical diabetes into a foot examination', () => {
    const output = completePhysicalExamSuggestions(record({ chiefComplaint: '高血压配药', historyOfPresentIllness: '患者既往确诊糖尿病。今高血压配药。', pastMedicalHistory: '糖尿病史' }), ['原发性高血压'], []);
    expect(output.map((item) => item.negativeRecordText).join('')).not.toContain('足背动脉');
  });

  it('does not accept an unrelated full-body baseline returned by the model', () => {
    const output = completePhysicalExamSuggestions(record({ chiefComplaint: '咳嗽' }), [], [suggestion('双足背动脉搏动可触及')]);
    expect(output.map((item) => item.negativeRecordText).join('')).not.toContain('足背动脉');
  });

  it('preserves explicit abnormalities and excludes competing normal candidates', () => {
    const physicalExam = '意识模糊，右肺呼吸音粗，可闻及湿啰音，心律不齐，腹部压痛，左下肢水肿。';
    const input = record({ chiefComplaint: '咳嗽、腹痛、高血压复诊', physicalExam });
    const suggestions = completePhysicalExamSuggestions(input, [], []);
    const output = suggestions.reduce(mergeClinicalRecordSuggestionIntoText, physicalExam);
    expect(output.startsWith(physicalExam)).toBe(true);
    for (const negative of ['神清', '呼吸音清', '未闻及干湿性啰音', '心律齐', '无压痛', '无水肿']) expect(output).not.toContain(negative);
  });

  it('deduplicates synonyms and keeps important extensions with AI priority', () => {
    const output = completePhysicalExamSuggestions(record({ chiefComplaint: '腹痛', physicalExam: '意识清楚。腹部柔软。' }), [], [suggestion('无反跳痛')]);
    const text = output.map((item) => item.negativeRecordText).join('');
    expect(text).not.toContain('神清'); expect(text).not.toContain('腹平软');
    expect(output.find((item) => item.negativeRecordText === '无反跳痛')?.priority).toBe('critical');
  });

  it('blocks invented measurements, generic conclusions and unsupported unilateral findings', () => {
    for (const text of ['血氧饱和度98%', '体温36.5℃', '肌力5级', '神经系统检查阴性', '右肺呼吸音粗']) {
      expect(canAppendPhysicalExamCandidate(text, '')).toBe(false);
    }
    expect(canAppendPhysicalExamCandidate('血氧饱和度:{血氧饱和度}%', '')).toBe(true);
  });

  it.each(['双肺呼吸音清', '右肺呼吸音减弱', '双肺呼吸音粗'])('keeps the explicit finding instead of the default: %s', (physicalExam) => {
    const output = completePhysicalExamSuggestions(record({ chiefComplaint: '咳嗽', physicalExam }), [], [suggestion('双肺呼吸音清')]);
    expect(output.some((item) => item.negativeRecordText.includes('呼吸音'))).toBe(false);
    expect(output.reduce(mergeClinicalRecordSuggestionIntoText, physicalExam).startsWith(physicalExam)).toBe(true);
  });

  it('uses the agreed template when the model returns a generic normal draft', () => {
    const output = completePhysicalExamSuggestions(record({ chiefComplaint: '咳嗽' }), [], [suggestion('双肺呼吸音清')]);
    expect(output.filter((item) => item.negativeRecordText.includes('呼吸音'))).toEqual([
      expect.objectContaining({ negativeRecordText: '双肺呼吸音粗', status: 'pending' }),
    ]);
  });

  it('does not discard the physical examination after eight history suggestions', () => {
    const histories = Array.from({ length: 8 }, (_, i) => ({ ...suggestion(`否认病史${i}`), field: 'pastMedicalHistory' as const }));
    const result = normalizeClinicalRecordFactSuggestions({ items: [...histories, suggestion('双肺呼吸音粗')] });
    expect(result).toHaveLength(9);
    expect(result[8].field).toBe('physicalExam');
  });

  it('keeps editable AI text in the record but excludes it from inference evidence', () => {
    const explicit = 'T:{38}℃。右下腹压痛。';
    const draft = suggestion('双肺呼吸音粗');
    const text = mergeClinicalRecordSuggestionIntoText(explicit, draft);
    expect(text).toContain('双肺呼吸音粗');
    expect(stripUnverifiedPhysicalExam(text, [draft])).toBe(explicit);
    expect(mergeClinicalRecordSuggestionIntoText(text, draft)).toBe(text);
    expect(stripUnverifiedPhysicalExam(text, [{ ...draft, status: 'dismissed' }])).toBe(text);
  });

  it('adds relevant body measurements without inventing values or changing the five-slot contract', () => {
    const input = { chiefComplaint: '糖尿病复诊', historyOfPresentIllness: '', diagnosisNames: ['2型糖尿病'], physicalExam: '血压130/80mmHg，体重65kg。' };
    const exam = buildOutpatientRecord(input).physicalExam;
    expect(exam).toContain('身高:{身高}cm，体重:{65}kg，腰围:{腰围}cm');
    expect(collectPhysicalExamVitalSigns(exam)?.items.map((item) => item.slotKey)).toEqual(['systolicBloodPressure', 'diastolicBloodPressure']);
    expect(buildOutpatientRecord({ ...input, physicalExam: exam }).physicalExam).toBe(exam);
    expect(buildOutpatientRecord({ chiefComplaint: '咳嗽', historyOfPresentIllness: '' }).physicalExam).not.toContain('腰围');
  });
});
