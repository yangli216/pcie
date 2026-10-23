import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { assertSynthetic, createFixtures, hisResponse } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const runtime = path.join(root, 'output/gbase-client-runtime/.local');
const staticFiles = new Map([
  ['/', ['page.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

export function createMockServer({ evidenceDirectory = runtime } = {}) {
  const token = `synthetic-${randomBytes(24).toString('hex')}`;
  let previous = {};
  if (evidenceDirectory) {
    try { previous = JSON.parse(readFileSync(path.join(evidenceDirectory, 'sdk-evidence.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const requests = previous.requests || [];
  const evidence = previous.evidence || [];
  const send = (res, status, value, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
  };
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && staticFiles.has(pathname)) {
        const [file, type] = staticFiles.get(pathname);
        return send(res, 200, await readFile(path.join(here, file)), type);
      }
      if (req.method === 'GET' && pathname === '/sdk.js') return send(res, 200, await readFile(path.join(root, 'sdk/med-hermes-sdk.js')), 'text/javascript');
      if (req.method === 'GET' && pathname === '/fixtures') return send(res, 200, { ...createFixtures(), handshake: { emrAccessToken: token } });
      if (req.method === 'GET' && pathname === '/status') return send(res, 200, { synthetic: true, requests, evidence });
      if (req.method === 'GET' && pathname === '/rbmh.base.med.usage.dic') return send(res, 200, { items: [{ key: 'po', text: '口服' }] });
      if (req.method !== 'POST') return send(res, 404, { message: 'Not found' });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2_000_000) return send(res, 413, { message: '合成请求过大' });
      }
      const body = JSON.parse(raw || '{}');
      assertSynthetic(body);
      if (pathname === '/evidence') {
        // Only the known synthetic page's compact observations are persisted. Never accept credentials.
        if (!body || typeof body.name !== 'string' || !body.name.startsWith('pcie-gbase-client') || /emrAccessToken|apiKey|authorization|deviceToken|cookie/i.test(raw)) return send(res, 400, { message: 'Invalid evidence' });
        evidence.push({ ...body, observedAt: new Date().toISOString() });
        if (evidenceDirectory) {
          await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
          const evidencePath = path.join(evidenceDirectory, 'sdk-evidence.json');
          writeFileSync(`${evidencePath}.tmp`, JSON.stringify({ requests, evidence }, null, 2), { mode: 0o600 });
          renameSync(`${evidencePath}.tmp`, evidencePath);
        }
        return send(res, 200, { saved: true });
      }
      if (!pathname.startsWith('/api/phis.')) return send(res, 404, { message: 'Not found' });
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { code: 401, message: '模拟 HIS 授权无效' });
      const result = hisResponse(pathname, body);
      requests.push({ path: pathname, status: 200, observedAt: new Date().toISOString() });
      return send(res, 200, result);
    } catch (error) {
      return send(res, 400, { code: 400, message: error.message });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PCIE_MOCK_HIS_PORT || 4260);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
  const server = createMockServer();
  server.listen(port, '127.0.0.1', () => console.log(`PCIE 合成 HIS：http://127.0.0.1:${port}/（真实模型由 PCIE Server 提供）`));
}
