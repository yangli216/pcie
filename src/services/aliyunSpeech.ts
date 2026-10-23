/**
 * 阿里云 DashScope Paraformer 实时语音转写服务
 * 统一通过 PCIE Server 的签名 HTTP/WebSocket 代理。
 *
 * 官方文档: https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service
 */

import { transcribeAudio } from './llm';
import { DEFAULT_RETRY_CONFIG } from './llm/types';
import { SegmentedSpeechTranscriber } from './segmentedSpeechTranscriber';
import { getSpeechConfig, supportsRealtimeSpeech } from './speechConfig';
import {
    regionalPost,
    buildRegionalSpeechUploadPayload,
    createRegionalWebSocketUrl,
} from './regionalClient';
import { beginAiTrace, failAiTrace, finishAiTrace } from './aiTrace';

const REALTIME_RECONNECT_BACKOFF_CAPS_MS = [1000, 2000, 4000, 8000, 15000] as const;

/**
 * 计算实时语音重连等待时间：full jitter，且至少等待 1ms，避免立即重试。
 */
export function calculateRealtimeReconnectDelay(
    attempt: number,
    random: () => number = Math.random,
): number {
    const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
    const cap = REALTIME_RECONNECT_BACKOFF_CAPS_MS[
        Math.min(safeAttempt, REALTIME_RECONNECT_BACKOFF_CAPS_MS.length - 1)
    ];
    const sample = random();
    const normalizedSample = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
    return Math.max(1, Math.ceil(normalizedSample * cap));
}

/**
 * 快速测试模式示例文本
 * 启用测试模式时，直接返回此文本而不调用实际语音识别
 */
const TEST_MODE_SAMPLE_TEXT = `坐吧，先露手腕量个体温。啥时候开始发烧的？多少度？
昨天下午开始，在家量38.5℃，吃了对乙酰氨基酚，退了又烧。
除了发烧，还有别的不舒服吗？比如嗓子疼、咳嗽、浑身酸？
嗓子疼得厉害，干咳没痰，浑身软、关节酸，不流涕不拉肚子。
之前受凉了吗？接触过发烧的人吗？
前天淋雨受凉了，没接触过发烧的人，家里人都好。
张嘴"啊"——扁桃体肿、咽部红。除了退烧药，还吃别的药没？
没吃别的，我对青霉素过敏。
过敏史记下了。测下血氧、听下肺——血氧98%，肺部没问题，不是肺炎。
是流感吗？用拍胸片吗？
更像普通上感，不是流感。不用拍胸片，先查血常规+CRP，看是细菌还是病毒感染。
好，查完怎么用药？
病毒感染就对症休息、按时吃退烧药；细菌感染就开阿奇霉素，你不过敏。
明白。需要隔离吗？能上班吗？
不用强制隔离，建议居家休息3-5天，不烧了再上班。多喝水、清淡饮食、别熬夜。
好，谢谢医生。
拿着就诊卡去缴费抽血，结果出来找我。体温超39℃或胸闷气短，随时复诊。
知道了，谢谢！
慢走。`;

/**
 * 检查是否启用快速测试模式
 * 可通过环境变量 VITE_SPEECH_TEST_MODE=true 或 localStorage 设置
 */
export function isTestModeEnabled(): boolean {
    return localStorage.getItem('SPEECH_TEST_MODE') === 'true'
        || import.meta.env.VITE_SPEECH_TEST_MODE === 'true';
}

/**
 * 通过 PCIE Server 进行语音识别
 */
export async function transcribeWithAliyun(
    audioBlob: Blob,
): Promise<string> {
    // 检查测试模式
    if (isTestModeEnabled()) {
        console.log('[AliyunSpeech] TEST MODE: Returning sample text instead of real transcription');
        // 模拟延迟，让用户看到加载效果
        await new Promise(r => setTimeout(r, 500));
        return TEST_MODE_SAMPLE_TEXT;
    }

    const speechConfig = getSpeechConfig();
    const scene = 'voice-consultation';
    const fileName = `${scene}-${Date.now()}.pcm`;
    const trace = beginAiTrace({
        channel: 'speech_realtime',
        scene,
        sourceModule: 'aliyunSpeech',
        model: speechConfig.model,
        requestSummary: `场景 ${scene}，文件 ${fileName}，格式 ${audioBlob.type || 'audio/pcm'}`,
    });
    try {
        const payload = await buildRegionalSpeechUploadPayload(audioBlob, {
            mimeType: audioBlob.type || 'audio/pcm',
            format: 'pcm',
            scene,
            fileName,
        });
        const resp = await regionalPost<{ text: string }>('/v1/ai/speech/realtime', {
            ...payload,
            traceId: trace.traceId,
            sourceModule: 'aliyunSpeech',
            sessionId: trace.sessionId,
        });
        finishAiTrace(trace.traceId, {
            success: true,
            responseSummary: resp.text ? resp.text.slice(0, 160) : '转写结果为空',
        });
        return resp.text;
    } catch (error) {
        failAiTrace(trace.traceId, error instanceof Error ? error.message : String(error));
        throw error;
    }
}

export async function transcribeSpeech(audioBlob: Blob): Promise<string> {
    const speechConfig = getSpeechConfig();

    if (speechConfig.provider === 'openai-compatible') {
        return transcribeAudio(audioBlob);
    }

    return transcribeWithAliyun(audioBlob);
}


/**
 * 实时语音识别服务类
 * 支持两种服务端代理方式：
 * 1. 流式模式：通过签名 WebSocket 实时识别（优先）
 * 2. 批量模式：录音结束后批量转写（降级方案）
 */
export class RealtimeSpeechService {
    private audioChunks: Int16Array[] = [];
    private pendingAudioChunks: Int16Array[] = [];
    private onTextCallback?: (text: string, isFinal: boolean) => void;
    private isStarted: boolean = false;
    private isStreaming: boolean = false;
    private isFinishing: boolean = false;
    private hasStreamingStarted: boolean = false;
    private hadStreamingInterruption: boolean = false;
    private regionalSocket: WebSocket | null = null;
    private regionalFinalPromise: Promise<string> | null = null;
    private regionalFinalResolve?: (text: string) => void;
    private regionalFinalReject?: (error: Error) => void;
    private regionalFinalSettled: boolean = false;
    private reconnectPromise: Promise<void> | null = null;
    private reconnectTimer: number | null = null;
    private reconnectDelayResolve?: () => void;
    private socketGeneration: number = 0;
    private sessionEpoch: number = 0;
    private finalizedText: string = '';
    private currentSentence: string = '';
    private sessionTextPrefix: string = '';
    private segmentedTranscriber: SegmentedSpeechTranscriber | null = null;

    constructor(private readonly reconnectRandom: () => number = Math.random) {
    }

    /**
     * 开始录音会话
     * 优先尝试流式模式，失败则降级为批量模式
     */
    async start(onText?: (text: string, isFinal: boolean) => void): Promise<void> {
        this.cleanupRegionalSocket();
        const sessionEpoch = this.sessionEpoch;
        this.onTextCallback = onText;
        this.audioChunks = [];
        this.pendingAudioChunks = [];
        this.isStarted = true;
        this.isStreaming = false;
        this.isFinishing = false;
        this.hasStreamingStarted = false;
        this.hadStreamingInterruption = false;
        this.finalizedText = '';
        this.currentSentence = '';
        this.sessionTextPrefix = '';
        this.initializeRegionalFinalPromise();

        // 测试模式不走流式
        if (isTestModeEnabled()) {
            console.log('[Speech] Test mode, using batch mode');
            return;
        }

        const speechConfig = getSpeechConfig();
        if (speechConfig.provider === 'openai-compatible' && speechConfig.transcriptionMode === 'segmented' && onText) {
            this.segmentedTranscriber = new SegmentedSpeechTranscriber({
                sampleRate: speechConfig.sampleRate,
                segmentDurationMs: speechConfig.segmentDurationMs,
                transcribe: blob => transcribeAudio(blob, undefined, { ...DEFAULT_RETRY_CONFIG, maxRetries: 0 }),
                onText: text => {
                    if (this.sessionEpoch === sessionEpoch && this.isStarted && !this.isFinishing) {
                        this.onTextCallback?.(text, false);
                    }
                },
                onError: error => console.warn('[Speech] Segment failed; final recording remains available:', error),
            });
            return;
        }
        if (!supportsRealtimeSpeech(speechConfig.provider)) {
            console.log('[Speech] Batch-only provider configured, using batch mode');
            return;
        }
        try {
            await this.startRegionalStreaming(sessionEpoch);
            if (this.sessionEpoch !== sessionEpoch) return;
            console.log('[Speech] Regional streaming session started');
        } catch (error) {
            if (this.sessionEpoch !== sessionEpoch) return;
            console.warn('[Speech] Failed to start streaming, falling back to batch mode:', error);
            this.disposeRegionalSocket();
            this.isStreaming = false;
        }
    }

    /**
     * 接收音频数据块
     * 流式模式：通过签名 WebSocket 发送到 PCIE Server
     * 批量模式：存储到缓冲区
     */
    sendAudio(pcmData: Int16Array): void {
        if (!this.isStarted) return;

        const chunk = new Int16Array(pcmData);
        // 始终保留完整录音副本：首次建链失败和中途断线都能在停止后批量补录。
        this.audioChunks.push(chunk);
        this.segmentedTranscriber?.push(chunk);

        if (this.isStreaming && this.regionalSocket?.readyState === WebSocket.OPEN) {
            this.sendPcmChunk(this.regionalSocket, chunk);
            return;
        }

        if (this.hasStreamingStarted && !this.isFinishing) {
            this.enqueuePendingAudio(chunk);
            this.scheduleReconnect();
        }
    }

    /**
     * 结束录音并获取转写结果
     */
    async finish(): Promise<string> {
        if (!this.isStarted) {
            return '';
        }

        const sessionEpoch = this.sessionEpoch;
        this.segmentedTranscriber?.close();
        this.segmentedTranscriber = null;
        this.isStarted = false;
        this.isFinishing = true;
        this.cancelReconnectDelay();

        try {
            if (!this.hasStreamingStarted) {
                return await this.transcribeBufferedAudio();
            }
            return await this.finishRegionalStreaming();
        } finally {
            if (this.sessionEpoch === sessionEpoch) {
                this.audioChunks = [];
                this.pendingAudioChunks = [];
                this.cleanupRegionalSocket();
                this.isStreaming = false;
                this.isFinishing = false;
            }
        }
    }

    /**
     * 关闭会话
     */
    close(): void {
        this.isStarted = false;
        this.isFinishing = false;
        this.audioChunks = [];
        this.pendingAudioChunks = [];
        this.cleanupRegionalSocket();
        this.isStreaming = false;
    }

    /**
     * 检查会话是否已开始
     */
    isConnected(): boolean {
        return this.isStarted;
    }

    private async startRegionalStreaming(expectedSessionEpoch: number = this.sessionEpoch): Promise<void> {
        const socketUrl = await createRegionalWebSocketUrl('/v1/ai/speech/realtime/ws');
        if (this.sessionEpoch !== expectedSessionEpoch || !this.isStarted || this.isFinishing) {
            throw new Error('实时语音会话已结束');
        }
        const socket = new WebSocket(socketUrl);
        socket.binaryType = 'arraybuffer';
        const generation = ++this.socketGeneration;
        this.regionalSocket = socket;

        await new Promise<void>((resolve, reject) => {
            let opened = false;
            let settled = false;
            const timer = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                this.detachSocket(socket, true);
                reject(new Error('服务端实时语音 WebSocket 连接超时'));
            }, 8000);

            socket.onmessage = (event) => {
                if (!this.isActiveSocket(socket, generation)) return;
                this.handleRegionalSocketMessage(event.data, socket, generation);
            };

            socket.onopen = () => {
                if (this.sessionEpoch !== expectedSessionEpoch
                    || !this.isActiveSocket(socket, generation)
                    || !this.isStarted
                    || this.isFinishing) {
                    this.detachSocket(socket, true);
                    return;
                }
                opened = true;
                settled = true;
                window.clearTimeout(timer);
                this.isStreaming = true;
                this.hasStreamingStarted = true;
                this.sessionTextPrefix = `${this.finalizedText}${this.currentSentence}`;
                this.flushPendingAudio(socket, generation);
                resolve();
            };

            socket.onerror = () => {
                window.clearTimeout(timer);
                const error = new Error('服务端实时语音 WebSocket 连接异常');
                if (!opened) {
                    if (!settled) {
                        settled = true;
                        this.detachSocket(socket, true);
                        reject(error);
                    }
                    return;
                }
                this.handleStreamingInterruption(error, socket, generation);
            };

            socket.onclose = (event) => {
                window.clearTimeout(timer);
                if (!opened) {
                    if (!settled) {
                        settled = true;
                        this.detachSocket(socket, false);
                        reject(new Error(`服务端实时语音 WebSocket 建链后关闭（${event.code}）`));
                    }
                    return;
                }
                if (!this.isActiveSocket(socket, generation)) return;
                if (this.isFinishing) {
                    this.detachSocket(socket, false);
                    this.isStreaming = false;
                    if (!this.regionalFinalSettled) {
                        this.rejectRegionalFinal(new Error(`实时语音结束前连接已关闭（${event.code}）`));
                    }
                    return;
                }
                this.handleStreamingInterruption(
                    new Error(`实时语音连接已关闭（${event.code}）`),
                    socket,
                    generation,
                );
            };
        });
    }

    private handleRegionalSocketMessage(rawData: unknown, socket: WebSocket, generation: number): void {
        if (typeof rawData !== 'string') {
            return;
        }
        try {
            const payload = JSON.parse(rawData) as {
                type?: string;
                text?: string;
                isSentenceEnd?: boolean;
                message?: string;
            };

            if (payload.type === 'text') {
                const text = payload.text || '';
                if (payload.isSentenceEnd) {
                    this.finalizedText += text;
                    this.currentSentence = '';
                } else {
                    this.currentSentence = text;
                }
                this.onTextCallback?.(`${this.finalizedText}${this.currentSentence}`, Boolean(payload.isSentenceEnd));
                return;
            }

            if (payload.type === 'final') {
                const accumulated = this.acceptRemoteFinal(payload.text || '');
                this.onTextCallback?.(accumulated, true);
                if (this.isFinishing) {
                    this.resolveRegionalFinal(accumulated);
                } else {
                    this.handleStreamingInterruption(
                        new Error('上游实时语音任务提前结束'),
                        socket,
                        generation,
                    );
                }
                return;
            }

            if (payload.type === 'error') {
                const error = new Error(payload.message || '服务端实时语音识别失败');
                if (this.isFinishing) {
                    this.rejectRegionalFinal(error);
                } else {
                    this.handleStreamingInterruption(error, socket, generation);
                }
            }
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            if (this.isFinishing) {
                this.rejectRegionalFinal(normalized);
            } else {
                this.handleStreamingInterruption(normalized, socket, generation);
            }
        }
    }

    private async finishRegionalStreaming(): Promise<string> {
        let streamedText = `${this.finalizedText}${this.currentSentence}`;
        let finishError: unknown;
        try {
            if (this.regionalSocket?.readyState === WebSocket.OPEN) {
                this.regionalSocket.send(JSON.stringify({ type: 'finish' }));
                const finalText = await Promise.race([
                    this.regionalFinalPromise || Promise.resolve(streamedText),
                    new Promise<string>((_, reject) => window.setTimeout(
                        () => reject(new Error('等待实时语音最终结果超时')),
                        30000,
                    )),
                ]);
                streamedText = finalText || streamedText;
            } else {
                finishError = new Error('实时语音连接在停止录音前已中断');
            }
        } catch (error) {
            finishError = error;
        }

        if (this.hadStreamingInterruption || finishError) {
            console.warn('[Speech] Streaming session was interrupted, reconciling with batch transcription:', finishError);
            try {
                return await this.transcribeBufferedAudio();
            } catch (batchError) {
                if (streamedText) {
                    console.warn('[Speech] Batch reconciliation failed, keeping streamed text:', batchError);
                    this.onTextCallback?.(streamedText, true);
                    return streamedText;
                }
                throw batchError;
            }
        }

        this.onTextCallback?.(streamedText, true);
        return streamedText;
    }

    private async transcribeBufferedAudio(): Promise<string> {
        const sessionEpoch = this.sessionEpoch;
        const audioBlob = this.buildBufferedAudioBlob();
        console.log('[Speech] Batch mode, total audio:', audioBlob.size, 'bytes');
        const text = await transcribeSpeech(audioBlob);
        if (this.sessionEpoch === sessionEpoch) this.onTextCallback?.(text, true);
        return text;
    }

    private buildBufferedAudioBlob(): Blob {
        const totalLength = this.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const mergedData = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of this.audioChunks) {
            mergedData.set(chunk, offset);
            offset += chunk.length;
        }
        return new Blob([mergedData.buffer], { type: 'audio/pcm' });
    }

    private resolveRegionalFinal(text: string): void {
        if (this.regionalFinalSettled) {
            return;
        }
        this.regionalFinalSettled = true;
        this.regionalFinalResolve?.(text);
    }

    private rejectRegionalFinal(error: Error): void {
        if (this.regionalFinalSettled) {
            return;
        }
        this.regionalFinalSettled = true;
        this.regionalFinalReject?.(error);
    }

    private cleanupRegionalSocket(): void {
        this.segmentedTranscriber?.close();
        this.segmentedTranscriber = null;
        this.sessionEpoch += 1;
        this.cancelReconnectDelay();
        this.socketGeneration += 1;
        this.disposeRegionalSocket();
        this.reconnectPromise = null;
        this.regionalFinalPromise = null;
        this.regionalFinalResolve = undefined;
        this.regionalFinalReject = undefined;
        this.regionalFinalSettled = false;
    }

    private initializeRegionalFinalPromise(): void {
        this.regionalFinalSettled = false;
        this.regionalFinalPromise = new Promise<string>((resolve, reject) => {
            this.regionalFinalResolve = resolve;
            this.regionalFinalReject = reject;
        });
    }

    private disposeRegionalSocket(): void {
        if (this.regionalSocket) {
            this.detachSocket(this.regionalSocket, true);
        }
    }

    private isActiveSocket(socket: WebSocket, generation: number): boolean {
        return this.regionalSocket === socket && this.socketGeneration === generation;
    }

    private detachSocket(socket: WebSocket, close: boolean): void {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (this.regionalSocket === socket) {
            this.regionalSocket = null;
            this.socketGeneration += 1;
        }
        if (close && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            socket.close();
        }
    }

    private handleStreamingInterruption(error: Error, socket: WebSocket, generation: number): void {
        if (!this.isActiveSocket(socket, generation)) return;
        console.warn('[Speech] Realtime connection interrupted, scheduling reconnect:', error);
        this.hadStreamingInterruption = true;
        this.isStreaming = false;
        if (this.currentSentence) {
            this.finalizedText += this.currentSentence;
            this.currentSentence = '';
            this.onTextCallback?.(this.finalizedText, true);
        }
        this.detachSocket(socket, true);
        if (this.isStarted && !this.isFinishing) {
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectPromise || !this.isStarted || this.isFinishing || !this.hasStreamingStarted) {
            return;
        }

        const reconnectEpoch = this.sessionEpoch;
        this.reconnectPromise = (async () => {
            let attempt = 0;
            while (this.sessionEpoch === reconnectEpoch
                && this.isStarted
                && !this.isFinishing
                && !this.isStreaming) {
                const delay = calculateRealtimeReconnectDelay(attempt, this.reconnectRandom);
                await this.waitForReconnectDelay(delay);
                if (this.sessionEpoch !== reconnectEpoch
                    || !this.isStarted
                    || this.isFinishing
                    || this.isStreaming) return;
                try {
                    await this.startRegionalStreaming(reconnectEpoch);
                    if (this.sessionEpoch !== reconnectEpoch) return;
                    console.log('[Speech] Realtime connection restored');
                    return;
                } catch (error) {
                    this.hadStreamingInterruption = true;
                    attempt += 1;
                    console.warn('[Speech] Realtime reconnect failed:', error);
                }
            }
        })().finally(() => {
            if (this.sessionEpoch === reconnectEpoch) {
                this.reconnectPromise = null;
            }
        });
    }

    private waitForReconnectDelay(delay: number): Promise<void> {
        if (delay <= 0) return Promise.resolve();
        return new Promise((resolve) => {
            this.reconnectDelayResolve = resolve;
            this.reconnectTimer = window.setTimeout(() => {
                this.reconnectTimer = null;
                this.reconnectDelayResolve = undefined;
                resolve();
            }, delay);
        });
    }

    private cancelReconnectDelay(): void {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const resolve = this.reconnectDelayResolve;
        this.reconnectDelayResolve = undefined;
        resolve?.();
    }

    private enqueuePendingAudio(chunk: Int16Array): void {
        const maxPendingChunks = 240;
        this.pendingAudioChunks.push(new Int16Array(chunk));
        if (this.pendingAudioChunks.length > maxPendingChunks) {
            this.pendingAudioChunks.splice(0, this.pendingAudioChunks.length - maxPendingChunks);
        }
    }

    private flushPendingAudio(socket: WebSocket, generation: number): void {
        const pending = this.pendingAudioChunks.splice(0);
        for (let index = 0; index < pending.length; index += 1) {
            if (!this.isActiveSocket(socket, generation) || socket.readyState !== WebSocket.OPEN) {
                this.pendingAudioChunks.unshift(...pending.slice(index));
                return;
            }
            this.sendPcmChunk(socket, pending[index]);
        }
    }

    private sendPcmChunk(socket: WebSocket, pcmData: Int16Array): void {
        const bytes = new Uint8Array(pcmData.byteLength);
        bytes.set(new Uint8Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength));
        socket.send(bytes.buffer);
    }

    private acceptRemoteFinal(remoteFinal: string): string {
        const accumulated = `${this.finalizedText}${this.currentSentence}`;
        const sessionText = accumulated.startsWith(this.sessionTextPrefix)
            ? accumulated.slice(this.sessionTextPrefix.length)
            : accumulated;
        const finalSessionText = remoteFinal.length >= sessionText.length ? remoteFinal : sessionText;
        this.finalizedText = `${this.sessionTextPrefix}${finalSessionText}`;
        this.currentSentence = '';
        return this.finalizedText;
    }
}
