// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

const mocks = vi.hoisted(() => ({
  recorder: {
    start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    setOnAudioChunk: vi.fn(), getAnalyser: vi.fn(),
  },
  sessions: [] as Array<{ onText?: (text: string, isFinal: boolean) => void }>,
  finish: vi.fn(),
  chatStream: vi.fn(),
  transcribeAudio: vi.fn(),
  saveVoiceRecording: vi.fn(),
  trackClick: vi.fn(),
  trackError: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/services/audioRecorder', () => ({
  audioRecorder: mocks.recorder,
  getMicrophoneErrorMessage: () => '录音失败',
}));
vi.mock('@/services/aliyunSpeech', () => ({
  isTestModeEnabled: () => false,
  RealtimeSpeechService: class {
    onText?: (text: string, isFinal: boolean) => void;
    constructor() { mocks.sessions.push(this); }
    async start(callback: (text: string, isFinal: boolean) => void) { this.onText = callback; }
    finish() { return mocks.finish(); }
    close() {}
    isConnected() { return true; }
    sendAudio() {}
  },
}));
vi.mock('@/services/llm', async original => ({
  ...await original<typeof import('@/services/llm')>(),
  transcribeAudio: mocks.transcribeAudio, chatStream: mocks.chatStream, chat: vi.fn(),
}));
vi.mock('@/services/medicalData', () => ({
  medicalDataService: { ensureDiagnosisCatalogReady: async () => {}, getAllDiagnoses: () => [] },
}));
vi.mock('@/services/voiceRecordingStorage', () => ({ saveVoiceRecording: mocks.saveVoiceRecording }));
vi.mock('@/services/operationTracker', () => ({ trackClick: mocks.trackClick, trackError: mocks.trackError }));
vi.mock('../model/voiceTimingTracker', () => ({ voiceTimingTracker: { confirm: mocks.confirm } }));
vi.mock('@shared/ui/Icon.vue', () => ({ default: { template: '<span aria-hidden="true"></span>' } }));

import VoiceCapsule from './VoiceCapsule.vue';
import { useVoiceIntentRecognition } from '../model/useVoiceIntentRecognition';

// jsdom's Blob lacks arrayBuffer; keep browser Blob/FileReader semantics for WAV merging.
class ReadableBlob extends Blob {
  arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function wav(samples: number[]): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const word = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  word(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return new Blob([buffer], { type: 'audio/wav' });
}

let app: App | undefined;
let host: HTMLDivElement;
let audio: Blob;
const onStop = vi.fn();
const onAbandon = vi.fn();
const onStageChange = vi.fn();

async function settle() {
  for (let index = 0; index < 12; index += 1) { await Promise.resolve(); await nextTick(); }
}
async function mount() {
  host = document.createElement('div'); document.body.append(host);
  app = createApp(VoiceCapsule, { onStop, onAbandon, 'onWindow-stage-change': onStageChange });
  app.mount(host);
  await settle();
}
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.trim() === text);
  expect(found, `button ${text}`).toBeDefined();
  return found!;
}
async function preview(text = '合成分段草稿') {
  mocks.sessions[mocks.sessions.length - 1]!.onText?.(text, false);
  await settle();
}
async function stop() {
  host.querySelector<HTMLButtonElement>('button[title="结束接诊"]')!.click();
  await settle();
}
async function editor(): Promise<HTMLTextAreaElement> {
  if (!host.querySelector('textarea')) {
    host.querySelector<HTMLButtonElement>('button[title="展开"]')!.click();
    await settle();
  }
  return host.querySelector<HTMLTextAreaElement>('textarea')!;
}
function expectBlocked() {
  expect(button('确认').disabled).toBe(true);
  expect(button('继续采集').disabled).toBe(true);
}
function expectCompactPreview() {
  expect(onStageChange).toHaveBeenLastCalledWith('stopped');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).not.toContain('重试');
  expect(host.textContent).not.toContain('录音已保留');
  expect(mocks.transcribeAudio).not.toHaveBeenCalled();
}
async function failInitial() {
  mocks.finish.mockRejectedValueOnce(new Error('synthetic offline'));
  await mount(); await preview(); await stop();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Blob', ReadableBlob);
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'time').mockImplementation(() => {});
  vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
  mocks.sessions.length = 0;
  mocks.finish.mockReset().mockResolvedValue('合成完整转写');
  mocks.transcribeAudio.mockReset();
  mocks.recorder.start.mockReset().mockResolvedValue(undefined);
  audio = wav([11, 22, 33, 44, 55, 66, 777]);
  mocks.recorder.stop.mockReset().mockResolvedValue(audio);
  mocks.recorder.getAnalyser.mockReturnValue(null);
  mocks.saveVoiceRecording.mockResolvedValue({});
});
afterEach(async () => {
  app?.unmount(); app = undefined;
  await settle(); host?.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('voice capsule stopped recording review', () => {
  it.each([
    { label: '整段转写未完成', finish: () => Promise.reject(new Error('synthetic offline')), draft: '合成分段草稿' },
    { label: '转写结果异常', finish: async () => null, draft: '' },
  ])('shows $label in the compact header and allows editing the draft', async ({ label, finish, draft }) => {
    mocks.finish.mockImplementationOnce(finish);
    await mount(); await preview(draft); await stop();
    expect(host.querySelector('[aria-live]')?.textContent).toContain(label);
    expectCompactPreview();
    const field = await editor();
    expect(onStageChange).toHaveBeenLastCalledWith('expanded');
    expect(field.value).toBe(draft);
    expect(field.readOnly || field.disabled).toBe(false);
    expect(field.placeholder).toContain('手动填写');
    expectBlocked();
    button('确认').click(); button('继续采集').click(); await settle();
    expect(onStop).not.toHaveBeenCalled();
    expect(mocks.recorder.start).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledTimes(1);
  });

  it('confirms the doctor-edited text with the saved recording after a failed transcription', async () => {
    await failInitial();
    const field = await editor();
    field.value = '医生核对后手动填写的合成文字';
    field.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(button('确认').disabled).toBe(false);
    expect(button('继续采集').disabled).toBe(true);
    button('确认').click(); await settle();
    expect(onStop).toHaveBeenCalledExactlyOnceWith(audio, '医生核对后手动填写的合成文字');
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it('passes the retained segment draft to the consultation only after doctor confirmation', async () => {
    mocks.finish.mockResolvedValueOnce('');
    const intent = useVoiceIntentRecognition();
    onStop.mockImplementationOnce((_audio: Blob, text: string) => intent.processTranscript(text));
    await mount(); await preview(); await stop();
    expect(host.textContent).toContain('未识别到新增文字');
    expectCompactPreview();
    const field = await editor();
    expect(field.value).toBe('合成分段草稿');
    expect(field.readOnly).toBe(false);
    expect(button('确认').disabled).toBe(false);
    expect(button('继续采集').disabled).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
    button('确认').click(); await settle();
    expect(onStop).toHaveBeenCalledExactlyOnceWith(audio, '合成分段草稿');
    await vi.waitFor(() => expect(mocks.chatStream).toHaveBeenCalledTimes(1));
    const messages = mocks.chatStream.mock.calls[0][0];
    expect(messages[1]).toMatchObject({ role: 'user', content: expect.stringContaining('合成分段草稿') });
  });

  it('allows abandoning a pending transcription and ignores its late result', async () => {
    const pending = deferred<string>(); mocks.finish.mockReturnValueOnce(pending.promise);
    await mount(); await preview(); await stop();
    expectBlocked();
    expect((await editor()).readOnly).toBe(true);
    expect(button('放弃').disabled).toBe(false);
    button('放弃').click(); await settle();
    button('确认放弃').click(); await settle();
    expect(onAbandon).toHaveBeenCalledTimes(1);
    pending.resolve('已放弃的迟到正文'); await settle();
    expect(host.textContent).not.toContain('已放弃的迟到正文');
    expect(onStop).not.toHaveBeenCalled();
  });

  it('does not let an unmounted transcription update a new recording session', async () => {
    const pending = deferred<string>(); mocks.finish.mockReturnValueOnce(pending.promise);
    await mount(); await preview(); await stop();
    app!.unmount(); app = undefined; host.remove(); await settle();
    await mount(); await preview('新会话合成草稿');
    pending.resolve('旧会话迟到正文'); await settle();
    expect(host.textContent).toContain('新会话合成草稿');
    expect(host.textContent).not.toContain('旧会话迟到正文');
    expect(onStop).not.toHaveBeenCalled();
  });

  it('keeps both WAV segments and the previously edited prefix after a continued transcription fails', async () => {
    mocks.finish.mockResolvedValueOnce('第一段完整转写').mockRejectedValueOnce(new Error('second segment failed'));
    await mount(); await preview('第一段草稿'); await stop();
    const field = await editor(); field.value = '医生修订的第一段';
    field.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    const secondAudio = wav([101, 202, 303, 404]);
    mocks.recorder.stop.mockResolvedValue(secondAudio);
    button('继续采集').click(); await settle();
    await preview('第二段不完整草稿'); await stop();
    expectCompactPreview();
    const secondField = await editor();
    expect(secondField.value).toBe('医生修订的第一段\n第二段不完整草稿');
    expectBlocked();
    secondField.value = '医生修订的第一段\n医生补充的第二段';
    secondField.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    button('确认').click(); await settle();
    await vi.waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
    const [merged, transcript] = onStop.mock.calls[0] as [Blob, string];
    expect(transcript).toBe('医生修订的第一段\n医生补充的第二段');
    const data = new DataView(await merged.arrayBuffer());
    expect(data.getUint32(40, true)).toBe((7 + 4) * 2);
    expect(data.getInt16(44 + 6 * 2, true)).toBe(777);
    expect(data.getInt16(44 + 10 * 2, true)).toBe(404);
  });

  it.each(['确认', '继续采集'] as const)('keeps the edited prefix after a silent continued segment and permits %s', async action => {
    mocks.finish.mockResolvedValueOnce('第一段完整转写').mockResolvedValueOnce('  ').mockResolvedValueOnce('第三段完整转写');
    await mount(); await preview(); await stop();
    const field = await editor(); field.value = '医生修订的前段';
    field.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    const silentAudio = wav([0, 0, 0, 0]);
    mocks.recorder.stop.mockResolvedValue(silentAudio);
    button('继续采集').click(); await settle();
    await preview('待核对的第二段预览'); await stop();
    expect(host.textContent).toContain('未识别到新增文字');
    expect((await editor()).value).toBe('医生修订的前段\n待核对的第二段预览');
    expect((await editor()).readOnly).toBe(false);
    expect(button('确认').disabled).toBe(false);
    expect(button('继续采集').disabled).toBe(false);
    if (action === '确认') {
      button(action).click();
      await vi.waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
      expect(onStop.mock.calls[0][1]).toBe('医生修订的前段\n待核对的第二段预览');
      return;
    }
    button('继续采集').click(); await settle();
    expect(mocks.recorder.start).toHaveBeenCalledTimes(3);
    await preview('第三段预览'); await stop();
    expect((await editor()).value).toBe('医生修订的前段\n待核对的第二段预览\n第三段完整转写');
    expect(button('确认').disabled).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('deduplicates stop clicks and ignores a recorder result arriving after unmount', async () => {
    await mount(); await preview();
    const pending = deferred<Blob>(); mocks.recorder.stop.mockReturnValueOnce(pending.promise);
    const initialStops = mocks.recorder.stop.mock.calls.length;
    const stopButton = host.querySelector<HTMLButtonElement>('button[title="结束接诊"]')!;
    stopButton.click(); stopButton.click(); await settle();
    expect(mocks.recorder.stop).toHaveBeenCalledTimes(initialStops + 1);
    app!.unmount(); app = undefined; await settle();
    const stageChanges = onStageChange.mock.calls.length;
    pending.resolve(audio); await settle();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    expect(onStageChange).toHaveBeenCalledTimes(stageChanges);
  });

  it('allows doctor-edited confirmation when recording storage fails without saving empty audio', async () => {
    await mount(); await preview();
    mocks.recorder.stop.mockRejectedValueOnce(new Error('recorder failed'));
    await stop();
    expect(host.querySelector('[aria-live]')?.textContent).toContain('录音保存失败');
    expectCompactPreview();
    expectBlocked();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    const field = await editor();
    expect(field.readOnly).toBe(false);
    expect(field.placeholder).toContain('手动填写');
    field.value = '  医生核对后补全的文字  ';
    field.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(button('确认').disabled).toBe(false);
    expect(button('继续采集').disabled).toBe(true);
    const confirm = button('确认');
    confirm.click(); await settle();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0][0].size).toBe(0);
    expect(onStop.mock.calls[0][1]).toBe('医生核对后补全的文字');
    expect(mocks.saveVoiceRecording).not.toHaveBeenCalled();
    confirm.click(); await settle();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
