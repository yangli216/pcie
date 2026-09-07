import { PROMPTS } from '../prompts';
import {
  getCachedBootstrap,
  createRegionalSSE,
  regionalPost,
  buildRegionalSpeechUploadPayload,
} from './regionalClient';
import { beginAiTrace, failAiTrace, finishAiTrace, updateAiTraceRequestPayload } from './aiTrace';
import { normalizeRiskAnalysisPatientContext } from '../utils/patientProfile';
import {
  DEFAULT_LLM_CONFIG,
  DEFAULT_RETRY_CONFIG,
  type ChatMessage,
  type ChatRole,
  type LLMConfigOverride,
  type RetryConfig,
} from './llm/types';
import { getLLMConfig, getReviewerLLMConfig } from './llm/config';
import { retryWithBackoff } from './llm/retry';
import {
  buildChatRequestSummary,
  buildSpeechRequestSummary,
  createPayloadMessages,
  summarizeText,
} from './llm/payload';
import { formatUserFacingError } from '@shared/lib/errorMessages';

export type { ChatMessage, ChatRole, LLMConfigOverride, RetryConfig };
export { DEFAULT_LLM_CONFIG, DEFAULT_RETRY_CONFIG, getLLMConfig, getReviewerLLMConfig };

function resolveRegionalTraceModel(customConfig?: LLMConfigOverride): string | undefined {
  const bootstrap = getCachedBootstrap();
  if (!bootstrap) {
    return undefined;
  }
  if (customConfig?.configProfile === 'reviewer') {
    return bootstrap.reviewer?.model || bootstrap.llm?.model;
  }
  if (customConfig?.configProfile === 'fast') {
    return bootstrap.llm?.fastModel || bootstrap.llm?.model;
  }
  return bootstrap.llm?.model;
}

function buildRegionalChatRequestPayload(
  customConfig: LLMConfigOverride | undefined,
  payloadMessages: ReturnType<typeof createPayloadMessages>,
  trace: ReturnType<typeof beginAiTrace>,
  traceScene: string,
  traceSourceModule: string,
  stream: boolean
) {
  const enableSearch = customConfig?.enableWebSearch === true
    && traceScene === 'chat-stream'
    && traceSourceModule === 'chat_panel'
    && stream;

  return {
    configProfile: customConfig?.configProfile || 'default',
    consultationId: customConfig?.traceContext?.consultationId,
    messages: payloadMessages,
    stream,
    enableSearch,
    traceId: trace.traceId,
    scene: traceScene,
    sourceModule: traceSourceModule,
    sessionId: trace.sessionId,
  };
}

export async function chatStream(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  _apiKey?: string,
  retryConfig?: RetryConfig,
  onRetry?: (attempt: number, error: any) => void,
  customConfig?: LLMConfigOverride
): Promise<void> {
  {
    const payloadMessages = createPayloadMessages(messages);
    const traceScene = customConfig?.traceContext?.scene || 'chat';
    const traceSourceModule = customConfig?.traceContext?.sourceModule || 'llm';
    const requestSummary = buildChatRequestSummary(messages);
    const trace = beginAiTrace({
      channel: 'chat',
      scene: traceScene,
      sourceModule: traceSourceModule,
      operationModule: customConfig?.traceContext?.operationModule,
      operationAction: customConfig?.traceContext?.operationAction,
      title: customConfig?.traceContext?.title,
      consultationId: customConfig?.traceContext?.consultationId,
      configProfile: customConfig?.configProfile || 'default',
      model: resolveRegionalTraceModel(customConfig),
      requestSummary,
    });
    const requestPayload = buildRegionalChatRequestPayload(customConfig, payloadMessages, trace, traceScene, traceSourceModule, true);
    updateAiTraceRequestPayload(trace.traceId, requestPayload, requestSummary);
    let responseText = '';
    try {
      await retryWithBackoff(async () => {
        await createRegionalSSE('/v1/ai/chat', requestPayload, (chunk) => {
          responseText += chunk;
          onChunk(chunk);
        });
      }, retryConfig || DEFAULT_RETRY_CONFIG, onRetry);
      finishAiTrace(trace.traceId, {
        success: true,
        responseSummary: summarizeText(responseText, 160) || '流式响应已完成',
        responsePayload: { content: responseText },
      });
    } catch (error) {
      failAiTrace(trace.traceId, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return;
  }
}

// 带自动降级的流式对话（如果流式失败，自动回退到普通请求）
export async function chatStreamWithFallback(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  _apiKey?: string,
  retryConfig?: RetryConfig,
  onRetry?: (attempt: number, error: any) => void,
  customConfig?: LLMConfigOverride
): Promise<void> {
  try {
    // 尝试流式请求
    await chatStream(messages, onChunk, _apiKey, retryConfig, onRetry, customConfig);
  } catch (error) {
    console.warn("流式请求失败，降级到普通请求:", error);

    try {
      // 降级到普通请求
      const response = await chat(messages, _apiKey, retryConfig, onRetry, customConfig);
      // 模拟流式输出（按字符或按词输出）
      const chunkSize = 10; // 每次发送10个字符
      for (let i = 0; i < response.length; i += chunkSize) {
        onChunk(response.slice(i, i + chunkSize));
        // 添加小延迟以模拟流式效果
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } catch (fallbackError) {
      console.error("降级请求也失败:", fallbackError);
      throw fallbackError;
    }
  }
}

// 文本与图像的对话（基于 Chat Completions）
export async function chat(
  messages: ChatMessage[],
  _apiKey?: string,
  retryConfig?: RetryConfig,
  onRetry?: (attempt: number, error: any) => void,
  customConfig?: LLMConfigOverride
): Promise<string> {
  {
    const payloadMessages = createPayloadMessages(messages);
    const traceScene = customConfig?.traceContext?.scene || 'chat';
    const traceSourceModule = customConfig?.traceContext?.sourceModule || 'llm';
    const requestSummary = buildChatRequestSummary(messages);
    const trace = beginAiTrace({
      channel: 'chat',
      scene: traceScene,
      sourceModule: traceSourceModule,
      operationModule: customConfig?.traceContext?.operationModule,
      operationAction: customConfig?.traceContext?.operationAction,
      title: customConfig?.traceContext?.title,
      consultationId: customConfig?.traceContext?.consultationId,
      configProfile: customConfig?.configProfile || 'default',
      model: resolveRegionalTraceModel(customConfig),
      requestSummary,
    });
    const requestPayload = buildRegionalChatRequestPayload(customConfig, payloadMessages, trace, traceScene, traceSourceModule, false);
    updateAiTraceRequestPayload(trace.traceId, requestPayload, requestSummary);
    try {
      const content = await retryWithBackoff(async () => {
        const resp = await regionalPost<{ content: string }>('/v1/ai/chat', requestPayload);
        return resp.content;
      }, retryConfig || DEFAULT_RETRY_CONFIG, onRetry);
      finishAiTrace(trace.traceId, {
        success: true,
        responseSummary: summarizeText(content, 160) || '非流式响应为空',
        responsePayload: { content },
      });
      return content;
    } catch (error) {
      failAiTrace(trace.traceId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

// 快速/轻量级模型对话（适用于后台异步任务、总结等对响应时间要求高的场景）
export async function chatFast(
  messages: ChatMessage[],
  apiKey?: string,
  retryConfig?: RetryConfig,
  onRetry?: (attempt: number, error: any) => void,
  customConfig?: LLMConfigOverride
): Promise<string> {
  return chat(messages, apiKey, retryConfig, onRetry, { ...customConfig, configProfile: 'fast' });
}

export async function transcribeAudio(
  blob: Blob,
  _apiKey?: string,
  retryConfig?: RetryConfig,
  onRetry?: (attempt: number, error: any) => void,
  _customConfig?: LLMConfigOverride
): Promise<string> {
  {
    const scene = 'chat-input';
    const fileName = `${scene}-${Date.now()}.webm`;
    const requestSummary = buildSpeechRequestSummary(fileName, scene, blob.type || 'audio/webm');
    const trace = beginAiTrace({
      channel: 'speech_transcribe',
      scene,
      sourceModule: 'llm',
      model: getCachedBootstrap()?.llm?.audioModel,
      requestSummary,
    });
    try {
      const text = await retryWithBackoff(async () => {
        const payload = await buildRegionalSpeechUploadPayload(blob, {
          mimeType: blob.type || 'audio/webm',
          scene,
          fileName,
        });
        const requestPayload = {
          mimeType: payload.mimeType,
          format: payload.format,
          fileName: payload.fileName,
          scene: payload.scene,
          traceId: trace.traceId,
          sourceModule: 'llm',
          sessionId: trace.sessionId,
          audioSize: blob.size,
        };
        updateAiTraceRequestPayload(trace.traceId, requestPayload, requestSummary);
        const resp = await regionalPost<{ text: string }>('/v1/ai/speech/transcribe', {
          ...payload,
          traceId: trace.traceId,
          sourceModule: 'llm',
          sessionId: trace.sessionId,
        });
        return resp.text;
      }, retryConfig || DEFAULT_RETRY_CONFIG, onRetry);
      finishAiTrace(trace.traceId, {
        success: true,
        responseSummary: summarizeText(text, 160) || '转写结果为空',
        responsePayload: { text },
      });
      return text;
    } catch (error) {
      failAiTrace(trace.traceId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

export interface RiskAnalysisItem {
  level: 1 | 2 | 3;
  category: 'allergy' | 'chronic' | 'medication' | 'population' | 'vital' | 'other';
  content: string;
}

export async function analyzePatientRisks(patientData: any, apiKey?: string): Promise<RiskAnalysisItem[]> {
  const normalizedPatientData = normalizeRiskAnalysisPatientContext(patientData);
  const messages: ChatMessage[] = [
    { role: 'system', content: PROMPTS.consultation.patientRiskAnalysis.system },
    { role: 'user', content: PROMPTS.consultation.patientRiskAnalysis.buildUserPrompt(normalizedPatientData) }
  ];

  if (!normalizedPatientData.patientName || !normalizedPatientData.gender || !normalizedPatientData.age) {
    console.warn('[RiskAnalysis] Incomplete patient identity in prompt context', {
      patientName: normalizedPatientData.patientName,
      gender: normalizedPatientData.gender,
      age: normalizedPatientData.age,
      rawKeys: patientData && typeof patientData === 'object' ? Object.keys(patientData) : [],
    });
  }

  try {
    const response = await chat(messages, apiKey, undefined, undefined, {
      traceContext: {
        scene: 'reception-risk-analysis',
        sourceModule: 'reception_risk_analysis',
        operationModule: 'reception',
        operationAction: 'analyze_patient_risk',
        title: '接待风险评估',
      },
    });
    const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
    // Keep only the array part if surrounded by text
    const jsonMatch = cleanJson.match(/\[[\s\S]*\]/);
    const targetJson = jsonMatch ? jsonMatch[0] : cleanJson;

    return JSON.parse(targetJson);
  } catch (e) {
    console.error('Risk analysis failed:', e);
    // Return a fallback risk item to indicate failure
    return [{
      level: 3,
      category: 'other',
      content: '风险评估服务暂时不可用'
    }];
  }
}

export async function testLLMConnection(customConfig?: LLMConfigOverride): Promise<{ success: boolean; message: string }> {
  try {
    const messages: ChatMessage[] = [{ role: 'user', content: '您好，这只是一条测试消息，只需回复“测试成功”即可。' }];
    const response = await chat(messages, undefined, undefined, undefined, customConfig);
    if (response) {
      return { success: true, message: '连接成功！模型响应正常。' };
    } else {
      return { success: false, message: '请求成功，但模型未返回任何内容。' };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: formatUserFacingError(error, { fallback: '连接失败或配置有误' }),
    };
  }
}
