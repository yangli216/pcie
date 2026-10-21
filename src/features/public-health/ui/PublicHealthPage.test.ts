// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { usePublicHealthController } from '../model/usePublicHealthController';
import { testMealResult, testRequest, testResult, testTime, testUuid, testWeightRequest } from '../testFixtures';
import type { PublicHealthConfirmed, PublicHealthRequest } from '../types';
import PublicHealthPage from './PublicHealthPage.vue';

vi.mock('@/services/regionalClient', () => ({ regionalRequestResponse: vi.fn() }));

let app: App | undefined;
let host: HTMLDivElement;
async function settle() { for (let i = 0; i < 5; i += 1) { await Promise.resolve(); await nextTick(); } }
function mount(request = testWeightRequest(), makeResult = testResult) {
  let id = 100;
  let mountedController!: ReturnType<typeof usePublicHealthController>;
  const deps = {
    generate: vi.fn(async (request: PublicHealthRequest) => makeResult(request)),
    prepare: vi.fn(async () => undefined), confirm: vi.fn(async (_session: string, _payload: PublicHealthConfirmed) => undefined), close: vi.fn(async () => undefined),
    uuid: () => testUuid(id++), now: () => testTime,
  };
  host = document.createElement('div'); document.body.append(host);
  app = createApp({ setup() {
    const controller = usePublicHealthController(deps);
    mountedController = controller;
    controller.receiveLaunch({ bridgeSessionId: testUuid(50), request });
    return () => h(PublicHealthPage, { controller });
  } });
  app.mount(host);
  return { ...deps, receiveLaunch: (request: PublicHealthRequest) => mountedController.receiveLaunch({ bridgeSessionId: testUuid(50), request }) };
}
function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === text || item.textContent?.trim() === text);
  if (!found) throw new Error(`Missing visible button: ${text}`);
  return found;
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = Array.from(host.querySelectorAll('label')).find(item => item.querySelector('.field-label')?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!found) throw new Error(`Missing labeled field: ${label}`);
  return found;
}
function fill(label: string, value: string) {
  const input = field(label); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
}
function currentMeasurements() { return host.querySelector('[aria-label="本次测量与检查"]')!; }
function historicalMeasurements() { return host.querySelector<HTMLDetailsElement>('details')!; }
function factsPanel() { return host.querySelector('[aria-label="本次公卫资料"]')!; }
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });

describe('public health facts editing through the production page', () => {
  it('starts with a recommended meal and collapsed alternatives, switches independent drafts, and submits only the chosen meal', async () => {
    const deps = mount(testWeightRequest(), testMealResult); button('生成建议').click(); await settle();
    const textarea = () => host.querySelector<HTMLTextAreaElement>('[aria-label="食谱推荐正文"]')!;
    const doctorNotes = host.querySelector('[aria-label="医生提醒（不回写）"]')!;
    expect(doctorNotes.textContent).toContain('食谱推荐'); expect(doctorNotes.textContent).toContain('适用性待核实');
    expect(doctorNotes.querySelector('textarea')).toBeNull();
    expect(Array.from(host.querySelectorAll('textarea')).every(item => !item.value.includes('适用性待核实'))).toBe(true);
    const alternatives = Array.from(host.querySelectorAll<HTMLDetailsElement>('details')).find(item => item.querySelector('summary')?.textContent?.includes('备选食谱（2）'))!;
    expect(alternatives.open).toBe(false); expect(textarea().value).toContain('合成方案1');
    const edit = async (text: string) => { textarea().value = text; textarea().dispatchEvent(new Event('input', { bubbles: true })); await settle(); };
    const choose = async (n: number) => { host.querySelector<HTMLInputElement>(`[aria-label="采用备选食谱${n}：合成食谱${n + 1}"]`)!.click(); await settle(); };
    await edit('合成推荐项医生编辑'); alternatives.querySelector('summary')!.click(); await settle(); expect(alternatives.open).toBe(true);
    await choose(1); expect(textarea().value).toContain('合成方案2'); await edit('合成备选1医生编辑');
    await choose(2); expect(textarea().value).toContain('合成方案3'); await edit('合成备选2医生编辑');
    await choose(1); expect(textarea().value).toBe('合成备选1医生编辑');
    button('恢复推荐食谱').click(); await settle(); expect(textarea().value).toBe('合成推荐项医生编辑');
    await choose(2); expect(textarea().value).toBe('合成备选2医生编辑');
    host.querySelector<HTMLInputElement>('[aria-label="选择运动建议"]')!.click(); await settle();
    button('确认回写 PHIS').click(); await settle();
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm.mock.calls[0][1].items).toEqual([{ targetFieldId: 'target-meal_plan', sourceSections: ['meal_plan'], value: '合成备选2医生编辑' }]);
    expect(JSON.stringify(deps.confirm.mock.calls[0][1])).not.toContain('适用性待核实');
    expect(deps.confirm.mock.calls[0][1]).not.toHaveProperty('warnings');
    expect(textarea().readOnly).toBe(true); expect(host.textContent).toContain('等待 PHIS 保存');
    expect(Array.from(alternatives.querySelectorAll<HTMLInputElement>('input')).every(input => input.disabled)).toBe(true);
    await choose(1); expect(textarea().value).toBe('合成备选2医生编辑');
  });
  it('shows independent doctor notes, keeps two absent chapters empty and selectable only after physician completion', async () => {
    const deps = mount(testRequest(), request => {
      const result = testResult(request);
      result.sections[0].content = ''; result.sections[1].content = '';
      result.sections[2].content = '日常散步，若胸闷或头晕应停止活动，持续不适及时就诊。';
      result.warnings = [{ code: 'NO_MEDICATION_FACTS', sectionId: 'medication_guidance', message: '未提供用药类别资料，请医生核对。' },
        { code: 'RISK_EVIDENCE', sectionId: 'lifestyle_guidance', message: '证据：合成随访资料；AI 定性分析，待医生审核。' }];
      return result;
    });
    button('生成建议').click(); await settle();
    const check = host.querySelector<HTMLInputElement>('[aria-label="选择检查计划"]')!;
    const medication = host.querySelector<HTMLInputElement>('[aria-label="选择用药指导"]')!;
    expect(check.disabled).toBe(true); expect(check.checked).toBe(false);
    expect(medication.disabled).toBe(true); expect(medication.checked).toBe(false);
    const all = Array.from(host.querySelectorAll('label')).find(label => label.textContent?.includes('全选章节'))!.querySelector<HTMLInputElement>('input')!;
    expect(all.checked).toBe(true);
    const doctor = host.querySelector('[aria-label="医生提醒（不回写）"]')!;
    expect(doctor.textContent).toContain('未提供用药类别资料'); expect(doctor.textContent).toContain('证据：合成随访资料');
    const empty = host.querySelector<HTMLTextAreaElement>('[aria-label="用药指导正文"]')!;
    expect(empty.value).toBe(''); expect(empty.placeholder).toBe('');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="生活方式建议正文"]')!.value).toContain('持续不适及时就诊');
    const checkText = host.querySelector<HTMLTextAreaElement>('[aria-label="检查计划正文"]')!;
    checkText.value = '按预约日期携带检查资料到院。'; checkText.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(check.disabled).toBe(false); check.click(); await settle();
    checkText.value = ''; checkText.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(check.disabled).toBe(true); expect(check.checked).toBe(false);
    button('确认回写 PHIS').click(); await settle();
    expect(deps.confirm.mock.calls[0][1].items).toEqual([{ targetFieldId: 'target-lifestyle_guidance', sourceSections: ['lifestyle_guidance'], value: '日常散步，若胸闷或头晕应停止活动，持续不适及时就诊。' }]);
    expect(JSON.stringify(deps.confirm.mock.calls[0][1])).not.toContain('证据：');
    expect(JSON.stringify(deps.confirm.mock.calls[0][1])).not.toContain('请医生核对');
  });
  it.each(['health_prescription', 'weight_management'] as const)('lets the physician edit and confirm %s freeform text without a content warning', async capability => {
    const deps = mount(capability === 'weight_management' ? testWeightRequest() : testRequest(), request => {
      const result = testResult(request); result.sections[0].content = '合成建议：准备。活动。休息。结束。'; return result;
    });
    button('生成建议').click(); await settle();
    const label = capability === 'weight_management' ? '运动建议正文' : '检查计划正文';
    const text = host.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
    text.value = '制定依据\n来源：参考资料。BMI24，6.2 mmol/L。'; text.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(button('确认回写 PHIS').disabled).toBe(false);
    expect(host.textContent).not.toContain('正文含内部说明或医生核实提醒');
    button('确认回写 PHIS').click(); await settle();
    expect(deps.confirm.mock.calls[0][1].items[0].value).toBe(text.value);
  });
  it('resets meal choices and folding after confirmed regeneration', async () => {
    const deps = mount(testWeightRequest(), testMealResult); button('生成建议').click(); await settle();
    const alternatives = Array.from(host.querySelectorAll<HTMLDetailsElement>('details')).find(item => item.querySelector('summary')?.textContent?.includes('备选食谱（2）'))!;
    alternatives.querySelector('summary')!.click(); await settle();
    host.querySelector<HTMLInputElement>('[aria-label="采用备选食谱1：合成食谱2"]')!.click(); await settle();
    button('重新生成').click(); await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(item => item.textContent === '重新生成')!.click(); await settle();
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="食谱推荐正文"]')!.value).toContain('合成方案1');
    expect(Array.from(host.querySelectorAll<HTMLDetailsElement>('details')).find(item => item.querySelector('summary')?.textContent?.includes('备选食谱（2）'))!.open).toBe(false);
  });
  it('refreshes adopted facts immediately, reopens the latest values, and generates the latest of consecutive edits', async () => {
    const original = testWeightRequest(), before = structuredClone(original), deps = mount(original);
    expect(host.querySelector('[aria-label="本次健康画像"]')).toBeNull();
    button('生成建议').click(); await settle();
    expect(host.querySelector('[aria-label="服务端计算的只读减重指标"]')).not.toBeNull();
    button('资料核对与补充').click(); await nextTick();
    fill('身高（cm）', '170'); fill('体重（kg）', '68');
    fill('日常活动', '合成调整后的活动'); fill('饮食偏好', '合成调整后的饮食');
    button('保存补充资料').click(); await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(currentMeasurements().textContent).toContain('170 cm');
    expect(currentMeasurements().textContent).toContain('68 kg');
    expect(currentMeasurements().textContent).not.toContain('165 cm');
    expect(currentMeasurements().textContent).not.toContain('72 kg');
    expect(Array.from(currentMeasurements().querySelectorAll('li')).slice(0, 2).every(item => item.textContent?.includes('本次采用'))).toBe(true);
    expect(historicalMeasurements().open).toBe(false);
    expect(historicalMeasurements().textContent).toContain('165 cm');
    expect(historicalMeasurements().textContent).toContain('72 kg');
    expect(historicalMeasurements().textContent).toContain('来源：PHIS');
    expect(historicalMeasurements().querySelector('time')?.dateTime).toBe(testTime);
    expect(factsPanel().textContent).toContain('合成调整后的活动');
    expect(factsPanel().textContent).toContain('合成调整后的饮食');
    expect(factsPanel().textContent).not.toContain('原始散步资料');
    expect(factsPanel().textContent).not.toContain('原始饮食资料');
    expect(host.querySelector('[aria-label="服务端计算的只读减重指标"]')).toBeNull();
    expect(host.querySelector('[aria-label="运动建议正文"]')).toBeNull();
    expect(host.textContent).toContain('资料已更新，请核对后重新生成');

    button('资料核对与补充').click(); await nextTick();
    expect(field('身高（cm）').value).toBe('170'); expect(field('体重（kg）').value).toBe('68');
    expect(field('日常活动').value).toBe('合成调整后的活动');
    fill('身高（cm）', '171'); fill('体重（kg）', '67');
    button('保存补充资料').click(); await settle();
    expect(currentMeasurements().textContent).toContain('171 cm');
    expect(currentMeasurements().textContent).toContain('67 kg');
    expect(currentMeasurements().textContent).not.toContain('170 cm');
    expect(historicalMeasurements().querySelectorAll('li')).toHaveLength(4);
    expect(historicalMeasurements().textContent).toContain('170 cm');
    expect(historicalMeasurements().textContent).toContain('人工补充');

    button('生成建议').click(); await settle();
    expect(deps.generate).toHaveBeenCalledTimes(2);
    const sent = deps.generate.mock.calls[1][0];
    expect(sent.facts.weightProfile).toMatchObject({ heightCm: 171, weightKg: 67, activityDescription: '合成调整后的活动', dietPreferences: '合成调整后的饮食' });
    expect(sent.facts.observations.find(item => item.id === sent.facts.weightProfile!.heightObservationId)).toMatchObject({ code: 'height', value: 171, unit: 'cm', source: { system: 'PCIE_MANUAL' } });
    expect(sent.facts.observations.find(item => item.id === sent.facts.weightProfile!.weightObservationId)).toMatchObject({ code: 'weight', value: 67, unit: 'kg' });
    expect(deps.prepare.mock.calls[1]).toEqual([testUuid(50), sent]);
    expect(sent.requestId).not.toBe(original.requestId); expect(sent.originRequestId).toBe(original.originRequestId);
    expect(sent.recordVersion).toBe(original.recordVersion); expect(original).toEqual(before);
    expect(host.querySelector('[aria-label="服务端计算的只读减重指标"]')).not.toBeNull();
  });

  it('keeps cleared optional lifestyle empty when reopening instead of restoring original PHIS text', async () => {
    const deps = mount(); button('资料核对与补充').click(); await nextTick();
    fill('日常活动', ''); fill('饮食偏好', ''); button('保存补充资料').click(); await settle();
    expect(factsPanel().textContent).not.toContain('原始散步资料'); expect(factsPanel().textContent).not.toContain('原始饮食资料');
    expect(factsPanel().textContent).toContain('不吸烟（合成资料）');
    button('资料核对与补充').click(); await nextTick();
    expect(field('日常活动').value).toBe(''); expect(field('饮食偏好').value).toBe('');
    button('取消').click(); await nextTick(); button('生成建议').click(); await settle();
    const sent = deps.generate.mock.calls[0][0];
    expect(sent.facts.weightProfile?.activityDescription).toBeUndefined();
    expect(sent.facts.weightProfile?.dietPreferences).toBeUndefined();
    expect(sent.facts.lifestyle).toMatchObject({ exercise: '原始散步资料', diet: '原始饮食资料' });
  });

  it('updates a health-prescription summary immediately and reuses it for the next generation', async () => {
    const deps = mount(testRequest()); button('资料核对与补充').click(); await nextTick();
    expect(host.querySelector('input[type="number"]')).toBeNull();
    fill('病史与补充摘要', '合成更新后的随访摘要'); button('保存补充资料').click(); await settle();
    expect(factsPanel().textContent).toContain('合成更新后的随访摘要');
    button('展开资料与来源').click(); await nextTick();
    expect(host.querySelector('[aria-label="本次健康画像"]')!.textContent).toContain('合成更新后的随访摘要');
    button('资料核对与补充').click(); await nextTick();
    expect(field('病史与补充摘要').value).toBe('合成更新后的随访摘要');
    button('取消').click(); await nextTick(); button('生成建议').click(); await settle();
    expect(deps.generate.mock.calls[0][0].facts.historySummary).toBe('合成更新后的随访摘要');
    expect(host.querySelector('[aria-label="检查计划正文"]')).not.toBeNull();
  });

  it('rebuilds and folds the health profile when another caller task is launched, and hides it for weight management', async () => {
    const deps = mount(testRequest());
    button('展开资料与来源').click(); await nextTick();
    expect(host.querySelector('[aria-label="本次健康画像"]')!.textContent).toContain('合成测试资料');
    const next = testRequest(); next.originRequestId = testUuid(700); next.requestId = testUuid(700);
    next.patient.name = '另一个合成居民'; next.patientId = 'another-synthetic-patient';
    next.facts.historySummary = '另一个合成任务病史';
    next.facts.conditions = [{ code: 'synthetic-another', name: '另一个合成病种', status: '合成管理中' }];
    deps.receiveLaunch(next); await nextTick();
    const profile = host.querySelector('[aria-label="本次健康画像"]')!;
    expect(profile.textContent).toContain('另一个合成病种'); expect(profile.textContent).not.toContain('合成测试资料');
    expect(profile.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    button('展开资料与来源').click(); await nextTick();
    expect(profile.textContent).toContain('另一个合成任务病史');
    const weight = testWeightRequest(); weight.originRequestId = testUuid(701); weight.requestId = testUuid(701);
    deps.receiveLaunch(weight); await nextTick();
    expect(host.querySelector('[aria-label="本次健康画像"]')).toBeNull();
  });
});
