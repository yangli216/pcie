<script setup lang="ts">
import { ref, computed, inject, onBeforeUnmount } from "vue";
import type { ChatMessage } from "../services/llm";
import { chatStream } from "../services/llm";
import { RealtimeSpeechService } from "../services/aliyunSpeech";
import { audioRecorder, getMicrophoneErrorMessage } from "../services/audioRecorder";
import { useChatVoiceInput } from "@features/chat";
import { PROMPTS } from "../prompts";
import { feedbackService } from "../services/feedback";
import { trackClick, trackError } from "../services/operationTracker";
import {
  detectPromptInjection,
  INJECTION_BLOCK_RESPONSE,
  createStreamGuard,
  LEAKAGE_BLOCK_RESPONSE
} from "../services/promptGuard";
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css'; // 引入代码高亮样式
import Icon from "@shared/ui/Icon.vue";
import { formatUserFacingError } from "@shared/lib/errorMessages";

// 定义事件
const emit = defineEmits<{
  (e: 'open-consultation-assist'): void;
  (e: 'open-inside-cloud-home'): void;
  (e: 'open-feedback-dialog'): void;
  (e: 'handle-user-collapse'): void;
}>();

// 注入 showToast 方法
const showToast = inject<(message: string) => void>('showToast');

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: function (str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs"><code>' +
               hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
               '</code></pre>';
      } catch (__) {}
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
  }
});

// Markdown 渲染函数
const renderMarkdown = (content: string) => {
  return md.render(content);
};

const messages = ref<ChatMessage[]>([
  { role: "system", content: PROMPTS.chat.defaultSystem },
  { role: "assistant", content: PROMPTS.chat.welcomeMessage, isDefault: true }
]);

const visibleMessages = computed(() => messages.value.filter(m => m.role !== 'system'));
const input = ref("");
const imageDataUrl = ref<string | null>(null);
const sending = ref(false);
const webSearchEnabled = ref(false);

const chatVoiceInput = useChatVoiceInput({
  recorder: audioRecorder,
  createSpeechSession: () => new RealtimeSpeechService(),
});
const { recording } = chatVoiceInput;

function scrollToBottom() {
  requestAnimationFrame(() => {
    const el = document.getElementById("chat-scroll");
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  });
}

function removeEmptyAssistantPlaceholder() {
  const lastMessage = messages.value[messages.value.length - 1];
  if (lastMessage?.role === 'assistant' && !lastMessage.content.trim()) {
    messages.value.pop();
  }
}

function formatChatFailureMessage(error: unknown): string {
  return formatUserFacingError(error, {
    context: '抱歉，调用模型失败',
    fallback: '当前 AI 服务暂时不可用，请检查后台配置后重试。',
  });
}

async function handleSend() {
  if (!input.value.trim() && !imageDataUrl.value) return;
  sending.value = true;

  const startTime = Date.now();

  // 1. 构造用户消息
  const userMsg: ChatMessage = {
    role: "user",
    content: input.value.trim() || "",
    images: imageDataUrl.value ? [imageDataUrl.value] : undefined,
  };
  messages.value.push(userMsg);

  // 2. 立即清空输入框和图片
  const userContent = input.value.trim();
  trackClick('chat_send', { contentLength: userContent.length, hasImage: !!imageDataUrl.value });
  input.value = "";
  imageDataUrl.value = null;
  scrollToBottom();

  // 2.5 检测 prompt 注入攻击
  if (detectPromptInjection(userContent)) {
    messages.value.push({ role: "assistant", content: INJECTION_BLOCK_RESPONSE });
    scrollToBottom();
    sending.value = false;
    trackClick('chat_injection_blocked', { content: userContent.substring(0, 50) });
    return;
  }

  try {
    // 3. 保存用户消息到数据库
    const userMessageId = await feedbackService.saveMessage({
      role: 'user',
      content: userContent,
      images: userMsg.images,
    });
    userMsg.messageId = userMessageId;

    // 4. 构建消息列表
    const messagesForLLM: ChatMessage[] = [...messages.value.slice(0, -1)];
    // 添加用户消息
    messagesForLLM.push(userMsg);

    // 6. 创建空的助手回复消息
    const assistantMsg = ref<ChatMessage>({ role: "assistant", content: "" });
    messages.value.push(assistantMsg.value);

    // 7. 创建流式输出泄露检测器
    const streamGuard = createStreamGuard({ threshold: 2 });

    // 8. 调用流式接口（带泄露检测）
    await chatStream(messagesForLLM, (chunk) => {
      if (streamGuard.check(chunk)) {
        assistantMsg.value.content += chunk;
        scrollToBottom();
      } else {
        // 检测到泄露，替换输出
        assistantMsg.value.content = LEAKAGE_BLOCK_RESPONSE;
        scrollToBottom();
        trackClick('chat_leakage_blocked');
      }
    }, undefined, undefined, undefined, {
      enableWebSearch: webSearchEnabled.value,
      traceContext: {
        scene: 'chat-stream',
        sourceModule: 'chat_panel',
        operationModule: 'chat',
        operationAction: 'stream_reply',
        title: '聊天助手回复',
      },
    });

    // 8.5 最终检查（如果流式过程中被拦截）
    if (streamGuard.isBlocked()) {
      assistantMsg.value.content = LEAKAGE_BLOCK_RESPONSE;
    }

    // 9. 计算性能指标
    const latencyMs = Date.now() - startTime;
    const tokenCount = Math.ceil(assistantMsg.value.content.length / 2); // 简单估算

    // 10. 保存助手消息到数据库
    const assistantMessageId = await feedbackService.saveMessage({
      role: 'assistant',
      content: assistantMsg.value.content,
      tokenCount,
      latencyMs,
    });
    assistantMsg.value.messageId = assistantMessageId;
    assistantMsg.value.tokenCount = tokenCount;
    assistantMsg.value.latencyMs = latencyMs;

    // 11. 记录性能指标
    await feedbackService.recordMetric({
      metricType: 'llm_latency',
      metricValue: latencyMs,
      unit: 'ms',
    });

  } catch (err) {
    trackError('chat_send_failed', err);
    removeEmptyAssistantPlaceholder();
    const errorMessage = formatChatFailureMessage(err);
    messages.value.push({ role: "assistant", content: errorMessage });
    showToast?.(errorMessage);
    scrollToBottom();
  } finally {
    sending.value = false;
  }
}

// IME 状态处理
const isComposing = ref(false);

function onCompositionStart() {
  isComposing.value = true;
}

function onCompositionEnd() {
  // 使用 setTimeout 延迟重置，确保在 Enter 键（keydown）触发时 isComposing 仍为 true
  setTimeout(() => {
    isComposing.value = false;
  }, 0);
}

function handleEnter(e: KeyboardEvent) {
  if (isComposing.value || e.isComposing) return;
  handleSend();
}

function toggleWebSearch() {
  if (sending.value) return;
  webSearchEnabled.value = !webSearchEnabled.value;
  trackClick('chat_web_search_toggle', { enabled: webSearchEnabled.value });
}

// function handleFileChange(e: Event) {
//   const files = (e.target as HTMLInputElement).files;
//   if (!files || files.length === 0) return;
//   const file = files[0];
//   const reader = new FileReader();
//   reader.onload = () => {
//     imageDataUrl.value = reader.result as string;
//     trackClick('chat_image_upload');
//   };
//   reader.readAsDataURL(file);
// }

async function startRecording() {
  try {
    await chatVoiceInput.startRecording();
    trackClick('chat_voice_start');
  } catch (err) {
    trackError('chat_mic_permission_error', err);
    messages.value.push({ role: "assistant", content: `无法开始录音：${getMicrophoneErrorMessage(err)}` });
    scrollToBottom();
  }
}

async function stopRecording() {
  try {
    const text = await chatVoiceInput.stopRecording();
    trackClick('chat_voice_stop');
    input.value = text;
  } catch (err) {
    trackError('chat_transcription_failed', err);
    messages.value.push({
      role: "assistant",
      content: formatUserFacingError(err, {
        context: '语音识别失败',
        fallback: '请检查语音服务配置或稍后重试。',
      }),
    });
    scrollToBottom();
  }
}

onBeforeUnmount(() => {
  void chatVoiceInput.discardRecording();
});

// 处理反馈
async function handleFeedback(messageId: string, feedbackType: 'positive' | 'negative') {
  trackClick('chat_message_feedback', { feedbackType, messageId });
  try {
    const sessionId = feedbackService.getCurrentSessionId();
    if (!sessionId) {
      console.warn('[ChatPanel] No active session for feedback');
      return;
    }

    await feedbackService.saveFeedback({
      sessionId,
      targetType: 'message',
      targetId: messageId,
      feedbackType,
      rating: feedbackType === 'positive' ? 5 : 1,
    });

    showToast?.(feedbackType === 'positive' ? '感谢您的反馈！' : '我们会继续改进');
    console.log(`[ChatPanel] Feedback saved: ${feedbackType} for message ${messageId}`);
  } catch (error) {
    console.error('[ChatPanel] Failed to save feedback:', error);
    showToast?.('保存反馈失败，请稍后再试');
  }
}
</script>

<template>
  <div class="chat-panel">
   <div class="chat-panel-header" data-tauri-drag-region>
      <div class="toolbar-left" data-tauri-drag-region>
        <span class="assistant-title" data-tauri-drag-region>全医慧助（PCIE）</span>
      </div>
      <div class="toolbar-right" style="display: flex; gap: 8px;">
        <!-- <button class="icon-btn" aria-label="灵活触发" title="灵活触发" @click="emit('open-consultation-assist')">
          <Icon icon="lucide:sparkles" class="toolbar-icon" size="20" />
        </button> -->
        <button class="icon-btn" aria-label="知识库" title="知识库" @click="emit('open-inside-cloud-home')">
          <Icon icon="lucide:book-open" class="toolbar-icon" size="20" />
        </button>
        <button class="icon-btn feedback-entry-btn" aria-label="问题反馈" title="问题反馈" @click="emit('open-feedback-dialog')">
          <Icon icon="lucide:message-square-warning" class="toolbar-icon" size="20" />
        </button>
        <button class="icon-btn" aria-label="收起" title="收起" @click="emit('handle-user-collapse')">
          <Icon icon="lucide:chevron-down" class="toolbar-icon" size="20" />
        </button>
      </div>
    </div>
    <div id="chat-scroll" class="chat-body">
      <div v-for="(m, idx) in visibleMessages" :key="idx" class="msg" :class="m.role">
        <div v-if="m.isDefault" class="default-msg">
          <img class="default-msg-icon" src="/loading.png" alt="AI Agent" />
          <div class="default-msg-content">
            <div class="default-msg-title">Hi，我是全医慧助</div>
            <div class="markdown-body" v-html="renderMarkdown(m.content)"></div>
          </div>
        </div>
        <div v-else class="msg-container">
          <div class="msg-container-item">
            <img v-if="m.role === 'assistant'" class="avatar" style="margin-right: 10px;" src="/robot-avatar.png" alt="">
            <div class="bubble">
              <div v-if="m.role === 'assistant'" class="markdown-body" v-html="renderMarkdown(m.content)"></div>
              <div v-else class="user-text">{{ m.content }}</div>
            </div>
            <img v-if="m.role !== 'assistant'" class="avatar" style="margin-left: 10px;" src="/avatar/oldman.png" alt="">
          </div>
          <!-- 反馈按钮（仅助手消息） -->
          <div v-if="m.role === 'assistant' && m.messageId" class="feedback-buttons">
            <button
              class="feedback-btn"
              @click="handleFeedback(m.messageId!, 'positive')"
              title="有用"
              aria-label="标记此回复有用"
            >
              <Icon icon="lucide:thumbs-up" class="icon" size="16" aria-hidden="true" />
            </button>
            <button
              class="feedback-btn"
              @click="handleFeedback(m.messageId!, 'negative')"
              title="无用"
              aria-label="标记此回复无用"
            >
              <Icon icon="lucide:thumbs-down" class="icon" size="16" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div v-if="imageDataUrl" class="preview">
        <img :src="imageDataUrl" alt="preview" />
      </div>
    </div>

    <div class="chat-footer">
      <div class="input-wrapper">
        <!-- <label for="chat-input" class="sr-only">输入消息</label> -->
        <input
          id="chat-input"
          class="text-input"
          type="text"
          v-model="input"
          placeholder="请输入您的问题或描述症状..."
          aria-label="输入您的问题或描述症状"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown.enter="handleEnter"
          style="height: calc(100% - 32px)"
        />
       <div class="chat-footer-tools">
          <div class="chat-footer-tools-left">
            <!-- <label class="action-btn" title="选择图片" aria-label="选择图片">
              <Icon icon="lucide:image" class="icon" size="16" aria-hidden="true" />
              <input type="file" accept="image/*" @change="handleFileChange" hidden />
            </label> -->
            <button class="action-btn" :class="{ recording }" @click="recording ? stopRecording() : startRecording()"
              :aria-label="recording ? '停止录音' : '开始语音输入'" :title="recording ? '停止录音' : '语音输入'">
              <Icon :icon="recording ? 'lucide:mic-off' : 'lucide:mic'" class="icon" size="16" aria-hidden="true" />
            </button>
            <button
              class="action-btn web-search-btn"
              :class="{ active: webSearchEnabled }"
              :disabled="sending"
              :aria-pressed="webSearchEnabled"
              :aria-label="webSearchEnabled ? '关闭联网搜索' : '开启联网搜索'"
              :title="webSearchEnabled ? '关闭联网搜索' : '开启联网搜索'"
              @click="toggleWebSearch"
            >
              <Icon icon="lucide:globe" class="icon" size="16" aria-hidden="true" />
            </button>
          </div>
          <div class="chat-footer-tools-right">
            <button :class="{'send-btn': true, 'disabled': !input.trim() && !imageDataUrl}" :disabled="sending" :aria-busy="sending" :aria-label="sending ? '发送中...' : '发送消息'"
              @click="handleSend">
              <Icon v-if="sending" icon="lucide:loader-2" class="animate-spin" size="14" aria-hidden="true" />
              <Icon v-else icon="lucide:send" size="14" aria-hidden="true" />
              <span>发送</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

</template>

<style scoped>
.chat-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent; /* 让父容器背景透过来 */
  color: var(--color-text-strong);
  box-shadow: -4px 0px 12px 0px rgba(21,61,140,0.16);
}

.chat-panel-header {
  width: 100%;
  height: 44px;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.toolbar-left {
}

.assistant-title {
  font-family: Microsoft YaHei, Microsoft YaHei;
  font-weight: 700;
  font-size: 16px;
  color: #2469F2;
}

.chat-body {
  flex: 1;
  min-height: 0;
  padding: 12px 16px 8px;
  overflow-y: auto;
  overflow-x: hidden; /* 防止横向滚动 */
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Custom Scrollbar */
.chat-body::-webkit-scrollbar {
  width: 6px;
}
.chat-body::-webkit-scrollbar-track {
  background: transparent;
}
.chat-body::-webkit-scrollbar-thumb {
  background: var(--color-border-medium);
  border-radius: 3px;
}
.chat-body::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-strong);
}

.default-msg {
  width: min(100%, 360px);
  padding: 0 8px;
  position: relative;
  margin: 0 auto;
}

.default-msg-icon {
  position: absolute;
  top: 18px;
  left: 50%;
  width: 72px;
  height: 104px;
  transform: translateX(-50%);
  z-index: 0;
}

.default-msg-content {
  position: relative;
  z-index: 1;
  margin-top: 92px;
  background: #F2F8FF;
  border-radius: 12px;
  padding: 18px 20px;
}

.default-msg-title {
  font-family: Microsoft YaHei, Microsoft YaHei;
  font-weight: 700;
  font-size: 18px;
  color: #2469F2;
  text-align: center;
  margin-bottom: 8px;
}

/* 消息入场动画 */
.msg {
  display: flex;
  width: 100%;
  animation: slideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.msg.user { justify-content: flex-end; }
.msg.assistant { justify-content: flex-start; }

.msg-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.msg.assistant .msg-container {
  width: 100%;
  min-width: 0;
}

.msg.user .msg-container {
  align-items: flex-end;
  max-width: min(85%, 340px);
}

.msg-container-item {
  display: flex;
  align-items: flex-start;
}

.msg.assistant .msg-container-item {
  width: 100%;
  min-width: 0;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.bubble {
  padding: 10px 14px;
  line-height: 1.5;
  font-size: 14px;
  box-shadow: var(--shadow-sm);
  position: relative;
  width: 100%;
}

.msg.assistant .bubble {
  flex: 1;
  width: auto;
  min-width: 0;
  background: var(--surface-glass);
  color: var(--color-text-strong);
  border: 1px solid var(--color-border-light);
  border-radius: 1px 8px 8px 16px;
  border: 1px solid #CED3DB;
}

.msg.user .bubble {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 12px var(--color-primary-200);
  border-radius: 8px 0px 16px 8px;
}

/* Markdown 样式 */
.markdown-body {
  font-size: 14px;
  line-height: 1.6;
  font-family: Microsoft YaHei, Microsoft YaHei;
  font-weight: 400;
  font-size: 16px;
  color: #262626;
}
.markdown-body :deep(p) { margin: 0 0 10px 0; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(pre) {
  background: var(--color-background-gray);
  color: var(--color-text-primary);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 10px 0;
  border: 1px solid var(--color-border-light);
}
.markdown-body :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  background: var(--color-primary-50);
  padding: 2px 4px;
  border-radius: 4px;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}
.markdown-body :deep(ul), .markdown-body :deep(ol) {
  padding-left: 20px;
  margin: 10px 0;
}
.markdown-body :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}
.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.user-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: Microsoft YaHei, Microsoft YaHei;
  font-weight: 400;
  font-size: 16px;
  color: #FFFFFF;
}

.bubble pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  word-break: break-word; /* 防止长词溢出 */
  display: none; /* 隐藏旧的 pre */
}

/* 预览图 */
.preview {
  margin-top: 6px;
  align-self: flex-end;
}
.preview img {
  max-width: 120px;
  max-height: 120px;
  border-radius: 12px;
  border: 2px solid var(--color-border-light);
  box-shadow: var(--shadow-md);
}

.chat-footer {
  flex-shrink: 0;
  height: 112px;
  padding: 8px 16px 14px;
  display: flex;
  gap: 10px;
  align-items: stretch;
  position: relative;
  box-sizing: border-box;
}

/* 输入框容器化，包含文件和语音按钮 */
.input-wrapper {
  flex: 1;
  height: 100%;
  background: var(--color-background-white);
  display: flex;
  flex-direction: column;
  transition: all var(--duration-normal) var(--ease-out);
  border-radius: 12px;
  border: 2px solid #CED3DB;
  padding: 14px 16px 12px;
  box-sizing: border-box;
  overflow: hidden;
}
.input-wrapper:hover {
  border-color: var(--color-border-light);
}
.input-wrapper:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-200);
  background: var(--color-background-white);
}

.text-input {
  flex: 1;
  border: none !important;
  background: transparent;
  width: 100%;
  outline: none;
  font-size: 14px;
  color: var(--color-text-strong);
  padding: 0;
  box-sizing: border-box;
  line-height: 1.5;
  resize: none;
  min-height: calc(100% - 32px);
  max-height: 150px;
}
.text-input::placeholder { color: var(--color-text-muted); }

/* 禁用 input 自身的所有 focus 样式，因为焦点效果已应用在 input-wrapper 上 */
.text-input:focus,
.text-input:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  border: none !important;
}

.chat-footer-tools {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-footer-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-btn {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  transition: all var(--duration-normal) var(--ease-out);
  color: #262626;
}
.action-btn:hover {
  background: var(--color-primary-50);
  color: var(--color-primary);
}
.action-btn.recording {
  color: var(--color-error);
  background: var(--color-error-bg);
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.action-btn input { display: none; }
.action-btn .icon { width: 20px; height: 20px; }

.web-search-btn {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}
.web-search-btn.active {
  color: var(--color-primary);
  background: var(--color-primary-50);
}
.web-search-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.web-search-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.send-btn {
  width: 80px;
  min-height: 32px;
  height: 32px;
  max-height: 32px;
  border-radius: 16px;
  border: none;
  background: linear-gradient(135deg, var(--color-cta) 0%, var(--color-cta-dark) 100%);
  color: white;
  font-size: 0; /* 隐藏"发送"文字，只显示图标 */
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px var(--color-cta-200);
  transition: all var(--duration-normal) cubic-bezier(0.34, 1.56, 0.64, 1);
  font-family: Microsoft YaHei, Microsoft YaHei;
  font-weight: 400;
  font-size: 14px;
}
.send-btn.disabled {
  background: #DBDBDB;
  color: #999999;
}
.send-btn svg {
  margin-right: 4px;
}
.send-btn:hover:not(:disabled) {
  /* transform: scale(1.05) rotate(-10deg); */
  box-shadow: 0 6px 16px var(--color-cta-200);
}
.send-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  filter: grayscale(0.4);
}

/* 滚动条美化 - 使用上方的统一样式 */

/* 反馈按钮 */
.feedback-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  margin-left: 50px;
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-out);
}

.msg:hover .feedback-buttons {
  opacity: 1;
}

.feedback-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: var(--surface-glass-strong);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  transition: all var(--duration-normal) var(--ease-out);
  box-shadow: var(--shadow-sm);
}

.feedback-btn:hover {
  background: var(--color-background-white);
  color: var(--color-primary);
  transform: scale(1.1);
  box-shadow: var(--shadow-md);
}

.feedback-btn:active {
  transform: scale(0.95);
}

.feedback-btn .icon {
  width: 16px;
  height: 16px;
}

.feedback-btn:hover:first-child {
  color: var(--color-success); /* 绿色 - 点赞 */
}

.feedback-btn:hover:last-child {
  color: var(--color-error); /* 红色 - 踩 */
}

/* Loading 动画 - 发送按钮 */
.send-btn .animate-spin {
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Reduced Motion 支持 */
@media (prefers-reduced-motion: reduce) {
  .animate-spin {
    animation: none;
  }

  .msg {
    animation: none;
  }
}
</style>
