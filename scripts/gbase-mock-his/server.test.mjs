import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createMockServer } from './server.mjs';
import { createFixtures, hisResponse } from './fixtures.mjs';

test('workbench distinguishes successful transcription from confirmed synthetic writeback', async () => {
  const element = () => ({
    textContent: '', className: '', children: [],
    append(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
  });
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
  };
  const history = { evidence: [
    { name: 'pcie-gbase-client-microphone', stage: 'engineering-pass', message: '真实麦克风转写成功' },
    { name: 'pcie-gbase-client-outpatient', stage: 'mock-writeback-confirmed' },
    { name: 'pcie-gbase-client-outpatient', stage: 'engineering-pass', message: '真实模型生成成功' },
  ] };
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  await vm.runInNewContext(`(async () => { ${source}\n })()`, {
    document,
    window: { MedHermes: class { on() {} }, addEventListener() {} },
    fetch: async route => ({ json: async () => route === '/fixtures' ? createFixtures() : history }),
  });
  const rows = elements.get('results').children;
  const microphone = rows.find(row => row.children[0].textContent === '真实麦克风试音');
  const outpatient = rows.find(row => row.children[0].textContent === 'outpatient');
  assert.equal(microphone.children[2].textContent, '真实麦克风转写成功');
  assert.equal(outpatient.children[2].textContent, '模拟保存与回执成功；真实模型生成成功');
});

test('synthetic HIS uses authenticated local queries and refuses foreign identities or unknown routes', async t => {
  const server = createMockServer({ evidenceDirectory: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const fixtures = await fetch(`${url}/fixtures`).then(response => response.json());
  const post = (path, value, authenticated = true) => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${fixtures.handshake.emrAccessToken}` } : {}) }, body: JSON.stringify(value),
  });
  assert.equal((await post('/api/phis.aiAdapterService/queryVisitHistory', [{}], false)).status, 401);
  assert.equal((await post('/api/phis.aiAdapterService/queryVisitHistory', [{ params: { idPi: 'real-patient' } }])).status, 400);
  const catalog = await post('/api/phis.aiInpatientEmrContextService/queryAvailableExamLabItems', [{ orgCode: fixtures.orgCode }]);
  assert.equal(catalog.status, 200);
  const values = await catalog.json();
  assert.equal(values.body.items.length, 3);
  assert.ok(values.body.items.every(item => item.id.startsWith(fixtures.prefix) && item.mutualRecognitionCode.startsWith('SYNTHETIC-')));
  assert.equal((await post('/api/phis.aiAdapterService/saveRealRecord', [{ idPi: fixtures.patient.idPi }])).status, 400);
  assert.equal((await post('/v1/ai/chat', {})).status, 404);
  assert.equal((await post('/evidence', { name: 'pcie-gbase-client-probe', apiKey: 'must-not-persist' })).status, 400);
  assert.equal((await post('/evidence', { name: 'pcie-gbase-client-probe', stage: 'bridge-accepted' })).status, 200);
  const status = await fetch(`${url}/status`).then(response => response.json());
  assert.equal(status.evidence.length, 1);
  assert.equal(status.requests.length, 1);
  assert.ok(!JSON.stringify(status).includes(fixtures.handshake.emrAccessToken));
});

test('fixture provides paired template fields and identifiable synthetic inpatient and outpatient subjects', () => {
  const fixtures = createFixtures();
  const definitions = JSON.parse(fixtures.outpatient.templateDefinition).flatMap(article => article.eles);
  assert.deepEqual(definitions.map(field => field.ID), fixtures.outpatient.targetFieldIds);
  for (const field of definitions) assert.ok(fixtures.outpatient.templateHtml.includes(`data-id="${field.ID}"`));
  assert.match(fixtures.inpatient.admissionId, /^pcie-gbase-client/);
  assert.throws(() => hisResponse('/api/phis.aiAdapterService/queryHisAllergy', [{ idPi: 'unmarked-subject' }]), /合成身份/);
  const chest = hisResponse('/api/phis.aiAdapterService/loadHiBdCliDetail', [`${fixtures.prefix}-xray`, 'org']);
  assert.equal(chest.body.idSrv, `${fixtures.prefix}-xray`);
  assert.equal(chest.body.sdSrv, '31');
  const lab = hisResponse('/api/phis.aiInpatientEmrContextService/queryAvailableExamLabItems', [{}]).body.items.find(item => item.category === '检验');
  assert.ok(JSON.parse(lab.jsonField).sdSpecimen.startsWith(fixtures.prefix));
  const chronicHistory = hisResponse('/api/phis.aiAdapterService/queryVisitHistory', [{ params: { idPi: fixtures.chronicPatient.idPi } }]);
  assert.equal(chronicHistory.body.items.length, 1);
  const chronicDetail = hisResponse('/api/phis.aiAdapterService/loadClinicMedicalRecord', [{ idPi: fixtures.chronicPatient.idPi, idVis: chronicHistory.body.items[0].idVis }]);
  assert.equal(chronicDetail.body.presList[0].presSubList[0].idMedPro, `${fixtures.prefix}-med-1`);
  const inventory = hisResponse('/api/phis.aiAdapterService/queryInvSubList', [{ params: { idMedPro: `${fixtures.prefix}-med-1` } }]);
  assert.equal(inventory.body.items[0].naMedPro, '氨氯地平片');
  assert.equal(hisResponse('/api/phis.aiAdapterService/queryInvSubList', [{ params: { idSto: `${fixtures.prefix}-store` } }]).body.items.length, 3);
});

test('parallel observations survive a server restart as complete private evidence', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pcie-gbase-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = createMockServer({ evidenceDirectory: directory });
  await new Promise(resolve => first.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${first.address().port}`;
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${url}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `pcie-gbase-client-observation-${i}`, stage: 'accepted' }),
  })));
  assert.ok(responses.every(response => response.status === 200));
  first.closeAllConnections();
  await new Promise(resolve => first.close(resolve));
  const restored = createMockServer({ evidenceDirectory: directory });
  await new Promise(resolve => restored.listen(0, '127.0.0.1', resolve));
  t.after(() => { restored.closeAllConnections(); restored.close(); });
  const data = await fetch(`http://127.0.0.1:${restored.address().port}/status`).then(response => response.json());
  assert.equal(data.evidence.length, 20);
  assert.equal(new Set(data.evidence.map(item => item.name)).size, 20);
});
