// @ts-expect-error Node built-ins are provided by Vitest but @types/node is not a direct project dependency.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins are provided by Vitest but @types/node is not a direct project dependency.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const sdkSource = readFileSync(new URL('../../sdk/med-hermes-sdk.js', import.meta.url), 'utf8');

interface VoicePatient {
  idPi: string;
  idVis?: string;
  outpatientEmr?: Record<string, unknown>;
}

interface MedHermesInstance {
  startVoice(patient?: VoicePatient): Promise<Record<string, unknown>>;
  prepareOutpatientEmrTemplate(
    source: unknown,
    options: unknown,
  ): Record<string, unknown>;
  _http: {
    post: (path: string, payload: VoicePatient) => Promise<Record<string, unknown>>;
  };
  _callWithFallback(
    httpCall: () => Promise<Record<string, unknown>>,
    protocolPath?: string,
    params?: unknown,
  ): Promise<Record<string, unknown>>;
  _resumeEventChannelIfNeeded(): void;
}

type MedHermesConstructor = new () => MedHermesInstance;

function loadSdk(): MedHermesConstructor {
  const moduleState: { exports: unknown } = { exports: {} };
  const sandbox: Record<string, unknown> = {
    module: moduleState,
    exports: moduleState.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    console: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
  sandbox.globalThis = sandbox;
  runInNewContext(sdkSource, sandbox);
  return moduleState.exports as MedHermesConstructor;
}

function createTemplate(): Record<string, unknown> {
  return {
    templateId: 'TPL-001',
    templateName: '门诊模板',
    templateHtml: '  <section data-id="chief"></section>  ',
    templateDefinition: '  [{"ID":"chief"}]  ',
    targetFieldIds: ['chief'],
    requestId: 'REQ-001',
  };
}

function stubBridge(sdk: MedHermesInstance) {
  const post = vi.fn().mockResolvedValue({ status: 'success' });
  sdk._http.post = post;
  sdk._callWithFallback = httpCall => httpCall();
  sdk._resumeEventChannelIfNeeded = vi.fn();
  return post;
}

describe('MedHermes startVoice dynamic outpatient template', () => {
  it('posts the exact validated template pair without rewriting source strings', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubBridge(sdk);
    const template = createTemplate();

    await expect(sdk.startVoice({
      idPi: 'P001',
      idVis: 'VIS-001',
      outpatientEmr: template,
    })).resolves.toEqual({ status: 'success' });

    expect(post).toHaveBeenCalledWith('/consultation/start-voice', {
      idPi: 'P001',
      idVis: 'VIS-001',
      outpatientEmr: template,
    });
  });

  it('rejects missing idVis, unknown template fields and duplicate targets before Bridge', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubBridge(sdk);

    await expect(sdk.startVoice({
      idPi: 'P001',
      outpatientEmr: createTemplate(),
    })).rejects.toThrow('要求无首尾空白的 idVis');
    await expect(sdk.startVoice({
      idPi: 'P001',
      idVis: 'VIS-001',
      outpatientEmr: { ...createTemplate(), unsupported: true },
    })).rejects.toThrow('必须且只能包含六个文档化字段');
    await expect(sdk.startVoice({
      idPi: 'P001',
      idVis: 'VIS-001',
      outpatientEmr: { ...createTemplate(), targetFieldIds: ['chief', 'chief'] },
    })).rejects.toThrow('必须无空白且不重复');

    expect(post).not.toHaveBeenCalled();
  });
});

function encodeSource(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
}

const SOURCE_HTML = '  <section data-article="主诉"><span data-id="主诉文本">请输入主诉 🩺</span></section>\n';
const SOURCE_DEFINITION = ' [{"ID":"主诉","NAME":"主诉","ARTICLE":"主诉","eles":[]}]\n';
const HTML_PREFIX = 'data:text/html;charset=utf-8;base64,';
const DEFINITION_PREFIX = 'data:application/json;charset=utf-8;base64,';

function createSource() {
  return {
    idTep: 'TPL-源模板',
    tepName: '门诊内科',
    htmlContent: encodeSource(SOURCE_HTML),
    xmlContent: encodeSource(SOURCE_DEFINITION),
    teptContent: encodeSource('<section>不使用的打印模板</section>'),
  };
}

function createSourceOptions(): Record<string, unknown> {
  return { targetFieldIds: ['主诉文本'], requestId: 'REQ-SOURCE-01' };
}

describe('MedHermes prepareOutpatientEmrTemplate', () => {
  it('wraps a successful HIS response without decoding its Base64 bytes', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubBridge(sdk);
    const options = createSourceOptions();
    const template = sdk.prepareOutpatientEmrTemplate({ code: 200, count: 0, data: createSource() }, options);

    expect(template).toEqual({
      templateId: 'TPL-源模板',
      templateName: '门诊内科',
      templateHtml: HTML_PREFIX + encodeSource(SOURCE_HTML),
      templateDefinition: DEFINITION_PREFIX + encodeSource(SOURCE_DEFINITION),
      targetFieldIds: ['主诉文本'],
      requestId: 'REQ-SOURCE-01',
    });
    (options.targetFieldIds as string[]).push('医生签名');
    expect(template.targetFieldIds).toEqual(['主诉文本']);
    expect(post).not.toHaveBeenCalled();

    await sdk.startVoice({ idPi: 'P001', idVis: 'VIS-001', outpatientEmr: template });
    expect(post).toHaveBeenCalledWith('/consultation/start-voice', expect.objectContaining({ outpatientEmr: template }));
  });

  it('accepts the response data object and leaves scripts encoded and inert', () => {
    const sdk = new (loadSdk())();
    const html = SOURCE_HTML + '<script>throw new Error("MUST_NOT_EXECUTE")</script>';
    const template = sdk.prepareOutpatientEmrTemplate({
      ...createSource(), htmlContent: encodeSource(html),
    }, createSourceOptions());
    expect(template.templateHtml).toBe(HTML_PREFIX + encodeSource(html));
    expect(template.templateHtml).not.toContain('<script>');
  });

  it('forwards a real complete template fixture through startVoice with both originals still encoded', async () => {
    const html = readFileSync(new URL('../test/template-parsing/fixtures/real-template.html', import.meta.url), 'utf8');
    const definition = readFileSync(new URL('../test/template-parsing/fixtures/real-template.json', import.meta.url), 'utf8');
    const source = { ...createSource(), htmlContent: encodeSource(html), xmlContent: encodeSource(definition) };
    const sdk = new (loadSdk())();
    const post = stubBridge(sdk);
    const template = sdk.prepareOutpatientEmrTemplate({ code: 200, data: source }, createSourceOptions());
    await sdk.startVoice({ idPi: 'SYN-REAL-TPL-P', idVis: 'SYN-REAL-TPL-V', outpatientEmr: template });
    const sent = post.mock.calls[0][1].outpatientEmr;
    expect(Object.keys(sent)).toEqual(['templateId', 'templateName', 'templateHtml', 'templateDefinition', 'targetFieldIds', 'requestId']);
    expect(sent.templateHtml).toBe(HTML_PREFIX + source.htmlContent);
    expect(sent.templateDefinition).toBe(DEFINITION_PREFIX + source.xmlContent);
    expect(JSON.stringify(sent)).not.toContain('<section');
    expect(sent.templateDefinition).not.toContain('"ARTICLE"');
  });

  it.each([
    ['invalid UTF-8', { ...createSource(), htmlContent: '/w==' }],
    ['text instead of HTML', { ...createSource(), htmlContent: encodeSource('病历纯文本') }],
    ['malformed JSON', { ...createSource(), xmlContent: encodeSource('[') }],
    ['JSON object', { ...createSource(), xmlContent: encodeSource('{}') }],
    ['empty JSON array', { ...createSource(), xmlContent: encodeSource('[]') }],
  ])('leaves %s for PCIE Server content validation', async (_label, source) => {
    const sdk = new (loadSdk())();
    const post = stubBridge(sdk);
    const template = sdk.prepareOutpatientEmrTemplate(source, createSourceOptions());
    await sdk.startVoice({ idPi: 'SYN-P', idVis: 'SYN-V', outpatientEmr: template });
    expect(post).toHaveBeenCalledWith('/consultation/start-voice', expect.objectContaining({ outpatientEmr: {
      ...template, templateHtml: HTML_PREFIX + source.htmlContent, templateDefinition: DEFINITION_PREFIX + source.xmlContent,
    } }));
  });

  it.each([
    ['empty source', null],
    ['failed response', { code: 400, data: createSource() }],
    ['missing response code', { data: createSource() }],
    ['empty response data', { code: 200, data: null }],
    ['empty identity', { ...createSource(), idTep: '' }],
    ['padded name', { ...createSource(), tepName: ' 门诊' }],
    ['missing HTML with printing source present', { ...createSource(), htmlContent: undefined }],
    ['plain HTML', { ...createSource(), htmlContent: SOURCE_HTML }],
    ['invalid Base64', { ...createSource(), htmlContent: '!!!!' }],
    ['noncanonical Base64', { ...createSource(), htmlContent: 'Zh==' }],
    ['oversized original', { ...createSource(), htmlContent: btoa('a'.repeat(1024 * 1024 + 1)) }],
  ])('rejects %s before transport', (_label, source) => {
    const sdk = new (loadSdk())();
    const post = stubBridge(sdk);
    expect(() => sdk.prepareOutpatientEmrTemplate(source, createSourceOptions()))
      .toThrow('prepareOutpatientEmrTemplate');
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { requestId: 'REQ-001' },
    { requestId: 'REQ-001', targetFieldIds: [] },
    { requestId: 'REQ-001', targetFieldIds: ['主诉文本', '主诉文本'] },
    { requestId: 'REQ-001', targetFieldIds: [' 主诉文本'] },
    { requestId: ' REQ-001', targetFieldIds: ['主诉文本'] },
    { requestId: 'REQ-001', targetFieldIds: ['主诉文本'], inferAllFields: true },
  ])('requires an explicit valid scope and request identity (%j)', (options) => {
    const sdk = new (loadSdk())();
    expect(() => sdk.prepareOutpatientEmrTemplate(createSource(), options))
      .toThrow('prepareOutpatientEmrTemplate');
  });
});
