// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPatientContext } from '@/utils/patientContext';
import { applyOutpatientEmrHeaderValues, getOutpatientEmrHeaderValues } from './outpatientEmrHeader';

describe('outpatient EMR display header', () => {
  it('shows known visit metadata and keeps display numbers distinct from internal IDs', () => {
    const patient = buildPatientContext({
      payload: { idPi: 'SYN-P', idVis: 'SYN-V', naPi: '合成患者', sdSexText: '男', ageText: '36岁',
        department: '全科门诊', cdClinic: '001234', idCard: 'SYN-PRIVATE' },
    });
    const header = getOutpatientEmrHeaderValues(patient, 'SYN-V', '合成中心');
    expect(header).toEqual({ 页眉姓名: '合成患者', 页眉性别: '男', 页眉年龄: '36岁',
      页眉就诊科室: '全科门诊', 页眉医疗机构: '合成中心', 页眉病历号: '001234' });
    expect(getOutpatientEmrHeaderValues(patient, 'SYN-OTHER', '合成中心')).toEqual({});
    const sparse = buildPatientContext({ payload: { idPi: 'SYN-P', idVis: 'SYN-V' } });
    expect(getOutpatientEmrHeaderValues(sparse, 'SYN-V')).toMatchObject({ 页眉姓名: '', 页眉病历号: '' });
  });

  it('fills only empty read-only header slots, restores placeholders and preserves HIS values', () => {
    const root = document.createElement('div');
    root.innerHTML = '<header data-article="页眉">'
      + '<span data-id="页眉姓名" data-readonly="true"><span class="tag-value"><i class="placeholder">姓名</i></span></span>'
      + '<span data-id="页眉病历号" data-readonly="true"><span class="tag-value">00001</span></span>'
      + '<span data-id="页眉年龄" data-readonly="false"><span class="tag-value"></span></span></header>'
      + '<section data-article="正文"><span data-id="页眉姓名" data-readonly="true"><span class="tag-value"></span></span></section>';
    const [name, clinicNo, editableAge, bodyField] = root.querySelectorAll('.tag-value');
    const source = root.innerHTML;
    applyOutpatientEmrHeaderValues(root, { 页眉姓名: '<b>合成姓名</b>', 页眉病历号: 'Other', 页眉年龄: '36岁' });
    expect(name.textContent).toBe('<b>合成姓名</b>');
    expect(name.querySelector('b')).toBeNull();
    expect(clinicNo.textContent).toBe('00001');
    expect(editableAge.textContent).toBe('');
    expect(bodyField.textContent).toBe('');
    applyOutpatientEmrHeaderValues(root, { 页眉姓名: '更新姓名' });
    expect(name.textContent).toBe('更新姓名');
    applyOutpatientEmrHeaderValues(root, {});
    expect(root.innerHTML).toBe(source);
  });
});
