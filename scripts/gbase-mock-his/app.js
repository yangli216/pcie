const $ = id => document.getElementById(id);
const fixtures = await fetch('/fixtures').then(response => response.json());
const sdk = new window.MedHermes();
const pending = new Map();
const rows = new Map();
const writes = new Map();
let activeFeature = '';
let connecting;
let connected = false;
const labels = {
  ...Object.fromEntries([...document.querySelectorAll('[data-feature]')].map(button => [button.dataset.feature, button.textContent])),
  chat: 'AI 聊天（桌面）',
  knowledge: '知识库（桌面）',
  microphone: '真实麦克风试音',
};

$('patient-summary').textContent = `${fixtures.patient.chiefComplaint}。${fixtures.patient.vitals}`;
$('patient-identity').textContent = `${fixtures.patient.idPi}\n${fixtures.patient.idVis}`;
function status(feature, accepted, completed = '') {
  let row = rows.get(feature);
  if (!row) {
    row = document.createElement('tr');
    for (let i = 0; i < 3; i++) row.append(document.createElement('td'));
    row.children[0].textContent = labels[feature] || feature;
    $('results').prepend(row); rows.set(feature, row);
  }
  row.children[1].textContent = accepted;
  if (completed) row.children[2].textContent = completed;
  row.children[1].className = /问题|失败/.test(accepted) ? 'error' : '';
  row.children[2].className = /误判|失败/.test(row.children[2].textContent) ? 'error' : /成功/.test(row.children[2].textContent) ? 'ok' : '';
}
async function evidence(feature, stage, detail = {}) {
  await fetch('/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${fixtures.prefix}-${feature}`, stage, ...detail }) });
}
const history = await fetch('/status').then(response => response.json());
const confirmedWritebacks = new Set(history.evidence
  .filter(item => item.stage === 'mock-writeback-confirmed').map(item => item.name));
for (const item of history.evidence) {
  const feature = item.name.slice(`${fixtures.prefix}-`.length);
  if (item.stage === 'mock-writeback-confirmed') status(feature, '历史验证记录', '医生确认 → 模拟保存与回执成功');
  else if (item.stage === 'semantic-failure') status(feature, '已生成 · 内容问题', item.message);
  else if (item.stage === 'engineering-pass-clinical-pending') status(feature, '已观察桌面生成', '工程链路通过；医学待验收');
  else if (item.stage === 'engineering-pass' && !confirmedWritebacks.has(item.name)) status(feature, '已验证原生流程', item.message || '工程链路通过；医学待验收');
}
const latestObservations = new Map();
for (const item of history.evidence) {
  if (item.stage === 'engineering-pass' && item.message) latestObservations.set(item.name, item);
}
for (const item of latestObservations.values()) {
  const feature = item.name.slice(`${fixtures.prefix}-`.length);
  const confirmed = confirmedWritebacks.has(item.name);
  status(feature, '已验证原生流程', `${confirmed ? '模拟保存与回执成功；' : ''}${item.message}`);
}
const failures = new Map(history.evidence.filter(item => item.stage === 'semantic-failure').map(item => [item.name, item.message]));
$('validation-summary').textContent = [...failures.values()].join('；');
async function connect() {
  connecting = sdk.init({ ...fixtures.handshake, urt: fixtures.doctor, userRoleDeptIds: fixtures.doctor.userRoleDeptIds });
  await connecting;
  connected = true;
  $('connection').textContent = '已完成 SDK 握手'; $('connection').className = 'ok';
  await evidence('handshake', 'connected');
}
$('connect').onclick = () => connect().catch(showError);
$('ping').onclick = async () => {
  try { await sdk.ping(); $('connection').textContent = connected ? 'SDK 握手完成 · Bridge 在线' : 'Bridge 在线（仍需授权握手）'; } catch (error) { showError(error); }
};
function showError(error) { $('event-preview').textContent = error.message || String(error); }
function requestId(feature) { return `${fixtures.prefix}-${feature}-${Date.now()}`; }

async function simulateSave(payload, feature) {
  if (!payload.requestId || !$('auto-feedback').checked) return;
  const request = payload.requestId;
  if (writes.has(request)) return;
  writes.set(request, structuredClone(payload));
  $('write-count').textContent = `本页内存已保存 ${writes.size} 次，刷新页面即清空。`;
  try {
    await sdk.sendFeedback(request, 'success', '合成 HIS 页面内存模拟保存成功；未写入真实 PHIS', payload.items);
    status(feature, '收到医生确认事件', '模拟保存 + 原请求回执成功');
    await evidence(feature, 'mock-writeback-confirmed', { requestId: request, eventType: payload.resultType || 'reference-request', itemCount: payload.items?.length || 0, contentLength: JSON.stringify(payload).length });
  } catch (error) {
    writes.delete(request);
    status(feature, '收到医生确认事件', `回执失败：${error.message}`);
    await evidence(feature, 'mock-writeback-failed', { message: error.message });
  }
}
sdk.on('event', envelope => {
  const event = envelope.event;
  const payload = event.payload || {};
  const consultationId = event.consultationId || '';
  if (consultationId && !consultationId.startsWith(fixtures.prefix)) return;
  const feature = pending.get(payload.requestId) || activeFeature || 'event';
  $('event-preview').textContent = JSON.stringify(envelope, null, 2);
  status(feature, `事件：${event.type}`);
  void evidence(feature, 'sdk-event', { eventType: event.type, requestId: payload.requestId, contentLength: JSON.stringify(payload).length });
  if (['reference-request', 'record-confirmed'].includes(event.type) && payload.referenceStatus === 'pending') {
    void simulateSave(payload, feature);
  }
});
sdk.on('error', showError);

async function invokeFeature(feature) {
  if (!connecting) await connect(); else await connecting;
  activeFeature = feature;
  const currentPatient = feature === 'chronic'
    ? { ...fixtures.chronicPatient, idVis: requestId('chronic-visit') }
    : fixtures.patient;
  $('patient-title').textContent = `${currentPatient.naPi} · ${currentPatient.sdSexText} ${currentPatient.ageText}`;
  $('patient-summary').textContent = `${currentPatient.chiefComplaint}。${currentPatient.vitals}`;
  $('patient-identity').textContent = `${currentPatient.idPi}\n${currentPatient.idVis}`;
  const id = requestId(feature);
  pending.set(id, feature);
  status(feature, '正在调用…', '等待桌面生成 / 确认');
  await evidence(feature, 'requested', { requestId: id });
  let result;
  if (feature === 'chronic') {
    await sdk.stop();
    result = await sdk.receivePatient(currentPatient.idPi, currentPatient);
  }
  else if (feature === 'consultation') result = await sdk.startConsultation(fixtures.patient);
  else if (feature === 'outpatient') {
    const promise = sdk.analyzeOutpatientEmr({ ...fixtures.outpatient, requestId: id });
    status(feature, '等待医生确认（SDK Promise 未完成）');
    result = await promise;
    await simulateSave(result, feature);
  } else if (feature === 'inpatient') {
    const promise = sdk.generateInpatientEmr({ ...fixtures.inpatient, requestId: id });
    status(feature, '等待医生确认（SDK Promise 未完成）');
    result = await promise;
    await simulateSave(result, feature);
  } else if (feature === 'voice') {
    result = await sdk.startVoice({ ...fixtures.patient, outpatientEmr: {
      templateId: fixtures.outpatient.templateId, templateName: fixtures.outpatient.templateName,
      templateHtml: fixtures.outpatient.templateHtml, templateDefinition: fixtures.outpatient.templateDefinition,
      targetFieldIds: fixtures.outpatient.targetFieldIds, requestId: id,
    } });
  } else if (fixtures.reports[feature]) result = await sdk.interpretReport({ taskId: feature, query: fixtures.reports[feature], patient: fixtures.patient });
  else if (feature === 'risks') result = await sdk.sendRisks(fixtures.patient, [{ level: 3, category: 'other', content: '合成工程提示：症状加重或出现呼吸困难时及时就医。' }]);
  else {
    const patient = { ...fixtures.patient };
    if (['suggestedDx', 'diffDx'].includes(feature)) delete patient.diagnosis;
    result = await sdk.assist(patient, feature);
  }
  if (!writes.has(id)) status(feature, 'Bridge 已受理', '待核对桌面生成结果');
  await evidence(feature, 'bridge-accepted', { requestId: id, responseStatus: result?.status || result?.code || 'ok' });
}
for (const button of document.querySelectorAll('[data-feature]')) {
  button.onclick = async () => {
    button.disabled = true;
    const feature = button.dataset.feature;
    try { await invokeFeature(feature); }
    catch (error) { status(feature, '调用失败', error.message); showError(error); await evidence(feature, 'failed', { message: error.message }); }
    finally { button.disabled = false; }
  };
}
$('stop').onclick = async () => {
  try { await sdk.stop(); await evidence('stop', 'accepted'); $('connection').textContent = '已结束本次接诊'; } catch (error) { showError(error); }
};
$('refresh-status').onclick = async () => {
  const status = await fetch('/status').then(response => response.json());
  $('his-status').textContent = `HIS 成功调用 ${status.requests.length} 次：${[...new Set(status.requests.map(request => request.path.split('/').at(-1)))].join('、') || '尚无'}。`;
};
window.addEventListener('beforeunload', () => sdk.destroy());
