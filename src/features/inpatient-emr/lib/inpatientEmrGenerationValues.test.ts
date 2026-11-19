import { describe, expect, it } from 'vitest';
import { readInpatientEmrFieldValues } from './inpatientEmrGenerationValues';

const fields = ['basis', 'diff', 'vital'];

describe('inpatient model reply field projection', () => {
  it('reads field strings from surrounding text and Markdown, preserving the actual model text', () => {
    const text = ' 合成依据\n含"引号"、反斜杠\\及 ``` 文字。 ';
    const reply = '以下为结果：\n```json\n' + JSON.stringify({ basis: text, diff: '' }) + '\n```';
    expect(readInpatientEmrFieldValues(reply, fields)).toEqual({ basis: text, diff: '' });
  });

  it('retains blank values, labels and model wording without requiring every field', () => {
    expect(readInpatientEmrFieldValues('{"basis":"诊断依据","diff":"  "}', fields)).toEqual({ basis: '诊断依据', diff: '  ' });
    expect(readInpatientEmrFieldValues('{"basis":"待补充","unknown":"其他字段"}', fields)).toEqual({ basis: '待补充' });
  });

  it('reads recognizable scalar values from the explicit fieldValues envelope when another field is structured', () => {
    expect(readInpatientEmrFieldValues('{"fieldValues":{"vital":37.0,"diff":false,"basis":{"text":"nested"}}}', fields))
      .toEqual({ vital: '37.0', diff: 'false' });
    expect(readInpatientEmrFieldValues('{"vital":0,"diff":null,"basis":["unexpected"]}', fields)).toEqual({ vital: '0' });
  });

  it('uses the latest returned string for duplicate IDs and keeps unrelated usable fields', () => {
    expect(readInpatientEmrFieldValues('{"basis":"首稿","diff":"另一字段","basis":"修订"}', fields))
      .toEqual({ basis: '修订', diff: '另一字段' });
  });

  it('keeps identified fields when prose includes brackets or the reply contains two field maps', () => {
    const reply = '说明{样例}：{"basis":"合成依据"}\n{"diff":"合成鉴别"}';
    expect(readInpatientEmrFieldValues(reply, fields)).toEqual({ basis: '合成依据', diff: '合成鉴别' });
  });

  it('retains interrupted field text, including a prefixed reply and an incomplete escape', () => {
    const reply = '回复：{"fieldValues":{"vital":37,"basis":"合成依据","diff":"已接收\\n\\u5408\\u53';
    expect(readInpatientEmrFieldValues(reply, fields)).toEqual({ vital: '37', basis: '合成依据', diff: '已接收\n合' });
  });

  it.each(['', '模型返回的是说明文字', '{"error":{"basis":"错误消息"}}', '{"message":"diagnostic text"}', '{}'])(
    'does not turn unrecognized prose or nested diagnostics into a template value', (reply) => {
      expect(readInpatientEmrFieldValues(reply, fields)).toEqual({});
    },
  );
});
