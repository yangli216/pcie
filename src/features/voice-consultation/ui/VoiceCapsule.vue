<template>
  <div
    class="voice-capsule-wrapper"
    :class="{ 'voice-capsule-wrapper--processing': processing }"
    data-tauri-drag-region
  >
    <!-- Processing state: waiting for LLM analysis -->
    <template v-if="processing">
      <div class="processing-state">
        <div class="voice-capsule-bar voice-capsule-bar--processing">
          <div class="avatar-wrapper processing-pulse">
            <img src="/robot-avatar.png" alt="AI Agent" />
          </div>
          <div class="processing-main">
            <span class="processing-label">正在分析语音内容...</span>
          </div>
          <div class="processing-dots">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </div>
        <div class="processing-bar-shell">
          <div class="processing-bar-track">
            <div class="processing-bar-fill"></div>
          </div>
        </div>
      </div>
    </template>

    <!-- Recording state: compact TTPlayer-style bar -->
    <template v-else-if="!isStopped">
      <!-- Row 1: avatar + waveform + timer + controls -->
      <div class="voice-capsule-bar">
        <div class="avatar-wrapper" :class="{ 'speaking': isSpeaking }">
          <img src="/robot-avatar.png" alt="AI Agent" />
        </div>

        <canvas ref="canvasRef" class="waveform" width="100" height="28"></canvas>
        <span class="timer">{{ formatTime(duration) }}</span>

        <button
          class="ctl-btn"
          @click="togglePause"
          :title="isPaused ? '继续' : '暂停'"
        >
          <Icon :icon="isPaused ? 'lucide:play' : 'lucide:pause'" size="16" aria-hidden="true" />
        </button>
        <button class="ctl-btn stop" @click="handleStop" title="结束接诊">
          <Icon icon="lucide:square" size="16" aria-hidden="true" />
        </button>
        <button class="ctl-btn" @click="handleClose" title="收起">
          <Icon icon="lucide:x" size="16" aria-hidden="true" />
        </button>
      </div>

      <!-- Row 2: Scrolling lyrics-style transcription -->
      <div class="lyrics-row" v-if="realtimeText">
        <div class="lyrics-scroll" ref="transcriptionRef">
          <span>{{ realtimeText }}</span>
        </div>
      </div>
    </template>

    <!-- Stopped state: review & edit -->
    <template v-else>
      <!-- Stopped header row -->
      <div class="voice-capsule-bar stopped-bar">
        <div class="avatar-wrapper">
          <img src="/robot-avatar.png" alt="AI Agent" />
        </div>
        <span class="stopped-label">音频采集完成</span>
        <span class="timer">{{ formatTime(duration) }}</span>
        <span class="spacer"></span>
        <button class="ctl-btn" @click="isExpanded = !isExpanded" :title="isExpanded ? '收起' : '展开'">
          <Icon :icon="isExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'" size="16" aria-hidden="true" />
        </button>
      </div>

      <!-- Collapsed: single-line preview -->
      <div class="lyrics-row preview" v-if="!isExpanded" @click="isExpanded = true">
        <div class="preview-text">{{ editableText || '未识别到文字' }}</div>
      </div>

      <!-- Expanded: editable -->
      <div class="expanded-area" v-if="isExpanded">
        <textarea
          class="text-editor"
          v-model="editableText"
          placeholder="未识别到文字，可手动输入..."
          rows="6"
        ></textarea>
      </div>

      <!-- Action buttons -->
      <div v-if="confirmingAbandon" class="stopped-actions abandon-confirmation">
        <span class="abandon-confirmation-text">确认放弃本次语音问诊？</span>
        <button class="action-btn compact" :disabled="isFinalizing" @click="confirmingAbandon = false">返回</button>
        <button class="action-btn compact abandon-confirm" :disabled="isFinalizing" @click="handleAbandon">
          {{ isFinalizing ? '处理中...' : '确认放弃' }}
        </button>
      </div>
      <div v-else class="stopped-actions">
        <button class="action-btn abandon" :disabled="isFinalizing" @click="requestAbandon">放弃</button>
        <button class="action-btn resume" :disabled="isFinalizing" @click="handleContinue">
          <Icon icon="lucide:mic" size="15" aria-hidden="true" />
          继续采集
        </button>
        <button class="action-btn confirm" @click="handleConfirm" :disabled="isFinalizing || !editableText.trim()">
          {{ isFinalizing ? '处理中...' : '确认' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { audioRecorder, getMicrophoneErrorMessage } from '@/services/audioRecorder';
import { voiceTimingTracker } from '../model/voiceTimingTracker';
import { saveVoiceRecording } from '@/services/voiceRecordingStorage';
import { trackClick, trackError } from '@/services/operationTracker';
import type { VoiceInteractionWindowStage } from '@/constants/windowSizes';

// 获取当前主题的主色调
const getPrimaryColor = () => {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#0891B2';
};
import { RealtimeSpeechService } from '@/services/aliyunSpeech';
import Icon from '@shared/ui/Icon.vue';
import {
  appendVoiceTranscript,
  mergeVoiceRecordingSegments,
} from '../lib/voiceRecordingContinuation';

const props = withDefaults(defineProps<{
  processing?: boolean;
}>(), {
  processing: false,
});

const emit = defineEmits<{
  stop: [blob: Blob, transcriptionText: string];
  error: [error: any];
  close: [];
  abandon: [];
  'window-stage-change': [stage: VoiceInteractionWindowStage];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const transcriptionRef = ref<HTMLElement | null>(null);
const isPaused = ref(false);
const duration = ref(0);
const startTime = ref(0);
const realtimeText = ref('');
const prefersReducedMotion = ref(false);
const isStopped = ref(false);
const isExpanded = ref(false);
const editableText = ref('');
const isFinalizing = ref(false);
const confirmingAbandon = ref(false);
let stoppedBlob: Blob | null = null;
let completedAudioSegments: Blob[] = [];
let completedDurationSeconds = 0;
let reviewedTranscriptPrefix = '';
let currentSegmentTranscript = '';

// Resize window when entering stopped state
watch(isStopped, (stopped) => {
  if (stopped) {
    emit('window-stage-change', 'stopped');
  }
});

// Resize window when entering processing state
watch(() => props.processing, (isProcessing) => {
  if (isProcessing) {
    emit('window-stage-change', 'processing');
  }
});

// Resize window when expanding/collapsing text editor
watch(isExpanded, (expanded) => {
  emit('window-stage-change', expanded ? 'expanded' : 'stopped');
});

// Auto-scroll transcription text horizontally to always show the latest
watch(realtimeText, () => {
  nextTick(() => {
    if (transcriptionRef.value) {
      transcriptionRef.value.scrollLeft = transcriptionRef.value.scrollWidth;
    }
  });
});
let timerInterval: ReturnType<typeof setInterval> | null = null;
let animationFrameId: number | null = null;
let visualizerInterval: ReturnType<typeof setInterval> | null = null;
let speechService: RealtimeSpeechService | null = null;
let motionMediaQuery: MediaQueryList | null = null;
let motionPreferenceListener: ((event: MediaQueryListEvent) => void) | null = null;

const isSpeaking = computed(() => {
  // Simple check: if not paused and duration > 0, assume speaking/recording active
  return !isPaused.value && duration.value > 0;
});

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const clearTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

const clearVisualizer = () => {
  if (visualizerInterval) {
    clearInterval(visualizerInterval);
    visualizerInterval = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

const closeSpeechService = () => {
  if (speechService) {
    speechService.close();
    speechService = null;
  }
};

const cleanupRecordingResources = async () => {
  clearTimer();
  clearVisualizer();
  audioRecorder.setOnAudioChunk(undefined);
  await audioRecorder.stop().catch(() => {});
  closeSpeechService();
};

const resetRecordingState = () => {
  isPaused.value = false;
  isStopped.value = false;
  isExpanded.value = false;
  editableText.value = '';
  isFinalizing.value = false;
  confirmingAbandon.value = false;
  stoppedBlob = null;
  completedAudioSegments = [];
  completedDurationSeconds = 0;
  reviewedTranscriptPrefix = '';
  currentSegmentTranscript = '';
  realtimeText.value = '';
  duration.value = 0;
  startTime.value = 0;
};

const drawStaticVisualizer = () => {
  if (!canvasRef.value) return;
  const ctx = canvasRef.value.getContext('2d');
  if (!ctx) return;

  const analyser = audioRecorder.getAnalyser();
  if (!analyser) return;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  // 静态显示 - 仅更新当前音量，无动画
  analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);

  // 计算平均音量
  const sum = dataArray.reduce((a, b) => a + b, 0);
  const average = sum / bufferLength;
  const percent = average / 255;

  // 显示单个音量条
  const barWidth = canvasRef.value.width * 0.6;
  const height = Math.max(4, percent * canvasRef.value.height);
  const x = (canvasRef.value.width - barWidth) / 2;
  const y = (canvasRef.value.height - height) / 2;

  ctx.fillStyle = getPrimaryColor();
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.roundRect(x, y, barWidth, height, 2);
  ctx.fill();
};

const drawVisualizer = () => {
  if (!canvasRef.value) return;
  const ctx = canvasRef.value.getContext('2d');
  if (!ctx) return;

  const analyser = audioRecorder.getAnalyser();
  if (!analyser) return;

  // 如果用户偏好减少动画，使用静态显示
  if (prefersReducedMotion.value) {
    clearVisualizer();
    // 使用 setInterval 定期更新，而不是 requestAnimationFrame
    visualizerInterval = setInterval(() => {
      if (isPaused.value) return;
      drawStaticVisualizer();
    }, 100); // 每 100ms 更新一次，足够显示音量变化
    return;
  }

  clearVisualizer();

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (isPaused.value) {
      animationFrameId = requestAnimationFrame(draw);
      return;
    }

    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvasRef.value!.width, canvasRef.value!.height);

    // Draw simplified waveform (bars)
    const barWidth = 3;
    const gap = 2;
    const totalBars = Math.floor(canvasRef.value!.width / (barWidth + gap));

    // Use a subset of frequency data for better visuals (low-mid frequencies)
    const step = Math.floor(bufferLength / totalBars);

    ctx.fillStyle = getPrimaryColor();

    for(let i = 0; i < totalBars; i++) {
      const dataIndex = i * step;
      const value = dataArray[dataIndex] || 0;
      const percent = value / 255;
      const height = Math.max(4, percent * canvasRef.value!.height);
      const y = (canvasRef.value!.height - height) / 2;

      // Dynamic color opacity based on volume
      ctx.globalAlpha = 0.3 + (percent * 0.7);

      // Draw rounded rect equivalent
      ctx.beginPath();
      ctx.roundRect((i * (barWidth + gap)), y, barWidth, height, 2);
      ctx.fill();
    }

    animationFrameId = requestAnimationFrame(draw);
  };

  draw();
};

const startRecording = async (continueExisting = false) => {
  console.time('[VoiceCapsule] startRecording');
  try {
    await cleanupRecordingResources();
    if (!continueExisting) {
      resetRecordingState();
    } else {
      isPaused.value = false;
      isStopped.value = false;
      isExpanded.value = false;
      stoppedBlob = null;
      currentSegmentTranscript = '';
      realtimeText.value = reviewedTranscriptPrefix;
    }

    // 先获取麦克风权限并开始录音，不阻塞在语音服务初始化上
    console.log('[VoiceCapsule] Requesting microphone access...');
    try {
      await audioRecorder.start();
      console.log('[VoiceCapsule] Recorder started');
    } catch (e) {
      console.warn('[VoiceCapsule] audioRecorder.start() failed, continuing for mock mode', e);
    }
    startTime.value = Date.now();
    timerInterval = setInterval(() => {
        if (!isPaused.value) {
            duration.value = completedDurationSeconds + Math.floor((Date.now() - startTime.value) / 1000);
        }
    }, 1000);
    drawVisualizer();
    console.timeEnd('[VoiceCapsule] startRecording');
    trackClick('voice_recording_start');

    // 后台初始化流式语音识别服务（不阻塞录音）
    speechService = new RealtimeSpeechService();
    speechService.start((text, _isFinal) => {
      currentSegmentTranscript = text;
      realtimeText.value = appendVoiceTranscript(reviewedTranscriptPrefix, text);
    }).then(() => {
      // 语音服务就绪，开始发送音频
      audioRecorder.setOnAudioChunk((pcmData) => {
        if (speechService?.isConnected()) {
          speechService.sendAudio(pcmData);
        }
      });
      console.log('[VoiceCapsule] Speech service connected, sending audio');
    }).catch((err) => {
      console.warn('[VoiceCapsule] Speech service init failed, batch mode:', err);
      // 批量模式下仍需收集音频
      audioRecorder.setOnAudioChunk((pcmData) => {
        speechService?.sendAudio(pcmData);
      });
    });
  } catch (err) {
    console.error("[VoiceCapsule] Failed to start recording:", err);
    console.timeEnd('[VoiceCapsule] startRecording');
    trackError('voice_recording_start_failed', err);
    await cleanupRecordingResources();
    emit('error', getMicrophoneErrorMessage(err));
  }
};

const togglePause = () => {
  if (isPaused.value) {
    audioRecorder.resume();
  } else {
    audioRecorder.pause();
  }
  isPaused.value = !isPaused.value;
  trackClick('voice_recording_toggle_pause', { isPaused: isPaused.value });
};

const handleStop = async () => {
  console.log('[VoiceCapsule] handleStop called');
  trackClick('voice_recording_stop', { durationSeconds: duration.value });
  clearTimer();
  clearVisualizer();
  
  try {
    audioRecorder.setOnAudioChunk(undefined);
    console.log('[VoiceCapsule] Stopping recorder...');
    let blob: Blob;
    try {
      blob = await audioRecorder.stop();
    } catch (e) {
      console.warn('[VoiceCapsule] audioRecorder.stop() failed', e);
      blob = new Blob([], { type: 'audio/webm' });
    }
    console.log('[VoiceCapsule] Got blob:', blob.size, 'bytes');

    // 获取实时语音服务的最终结果
    let transcription = '';
    if (speechService) {
      console.log('[VoiceCapsule] Finishing speech service...');
      try {
        transcription = await speechService.finish();
      } catch (e) {
        console.warn('[VoiceCapsule] speechService.finish() failed', e);
      }
      console.log('[VoiceCapsule] Final transcription:', transcription);
      speechService = null;
    }

    const finalSegmentTranscription = (transcription || currentSegmentTranscript || '').trim();
    const finalTranscription = appendVoiceTranscript(
      reviewedTranscriptPrefix,
      finalSegmentTranscription,
    );

    // 进入已停止状态，允许医生审核/编辑文字
    stoppedBlob = blob;
    editableText.value = finalTranscription;
    realtimeText.value = finalTranscription;
    isStopped.value = true;
    console.log('[VoiceCapsule] Entered stopped state for review');
  } catch (err) {
    console.error("[VoiceCapsule] Failed to stop recording:", err);
    trackError('voice_recording_stop_failed', err);
    
    stoppedBlob = new Blob([], { type: 'audio/webm' });
    editableText.value = '';
    isStopped.value = true;
  }
};

const handleConfirm = async () => {
  if (isFinalizing.value || !editableText.value.trim()) return;
  trackClick('voice_transcription_confirm');
  if (!stoppedBlob) return;
  voiceTimingTracker.confirm();

  isFinalizing.value = true;
  const segments = [...completedAudioSegments, stoppedBlob];
  let finalBlob = stoppedBlob;
  try {
    finalBlob = await mergeVoiceRecordingSegments(segments);
  } catch (error) {
    console.warn('[VoiceCapsule] Failed to merge continued recording segments; using latest segment', error);
  }

  emit('stop', finalBlob, editableText.value.trim());
  // 审计音频落盘不参与病历生成关键路径；失败只记录日志，不能阻塞结果页打开。
  void saveAudioForDebug(finalBlob, editableText.value.trim()).catch((error) => {
    console.warn('[VoiceCapsule] saveAudioForDebug failed', error);
  });
};

const handleContinue = async () => {
  if (isFinalizing.value) return;
  confirmingAbandon.value = false;
  trackClick('voice_transcription_continue', {
    durationSeconds: duration.value,
    completedSegments: completedAudioSegments.length + Number(Boolean(stoppedBlob)),
  });

  if (stoppedBlob?.size) {
    completedAudioSegments.push(stoppedBlob);
  }
  reviewedTranscriptPrefix = editableText.value.trim();
  completedDurationSeconds = duration.value;
  emit('window-stage-change', 'recording');
  await startRecording(true);
};

const requestAbandon = () => {
  if (isFinalizing.value) return;
  trackClick('voice_recording_abandon_request', { durationSeconds: duration.value });
  confirmingAbandon.value = true;
};

const handleAbandon = async () => {
  if (isFinalizing.value) return;
  isFinalizing.value = true;
  trackClick('voice_recording_abandon_confirm', { durationSeconds: duration.value });
  await cleanupRecordingResources();
  emit('abandon');
};

const handleClose = async () => {
  trackClick('voice_recording_close');
  await cleanupRecordingResources();
  emit('close');
};

/**
 * 把音频和对应实时转写文本成对落盘到用户配置目录（默认 <app_data>/voice_recordings）
 * 便于后续追溯和质量审计。
 */
const saveAudioForDebug = async (blob: Blob, transcript: string) => {
  try {
    const result = await saveVoiceRecording(blob, transcript);
    console.log('[VoiceCapsule] Voice recording saved:', result);
  } catch (err) {
    console.error('[VoiceCapsule] Failed to save voice recording:', err);
  }
};

onMounted(() => {
  // 检查用户是否偏好减少动画
  motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReducedMotion.value = motionMediaQuery.matches;

  // 监听偏好变化
  motionPreferenceListener = (e: MediaQueryListEvent) => {
    prefersReducedMotion.value = e.matches;
    console.log('[VoiceCapsule] Motion preference changed:', e.matches ? 'reduced' : 'normal');
  };
  motionMediaQuery.addEventListener('change', motionPreferenceListener);

  // 启动录音
  startRecording();

  // 清理函数会在 onUnmounted 中处理
});

onUnmounted(() => {
  cleanupRecordingResources();

  // 清理媒体查询监听器
  if (motionMediaQuery && motionPreferenceListener) {
    motionMediaQuery.removeEventListener('change', motionPreferenceListener);
  }
  motionMediaQuery = null;
  motionPreferenceListener = null;
});
</script>

<style scoped>
/* ===== Wrapper: compact floating bar ===== */
.voice-capsule-wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.10);
  overflow: hidden;
}

.voice-capsule-wrapper--processing {
  min-height: 96px;
}

/* ===== Top bar: single row, all inline ===== */
.voice-capsule-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  flex-shrink: 0;
}

.voice-capsule-bar--processing {
  padding: 12px 12px 8px;
  min-height: 60px;
}

.avatar-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
}

.avatar-wrapper img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.avatar-wrapper.speaking::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--color-primary);
  opacity: 0;
  animation: pulse-ring 2s infinite;
}

@keyframes pulse-ring {
  0% { transform: scale(0.85); opacity: 1; }
  100% { transform: scale(1.35); opacity: 0; }
}

.waveform {
  flex: 1;
  min-width: 60px;
  height: 28px;
}

.timer {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #64748b;
  flex-shrink: 0;
  min-width: 36px;
  text-align: right;
}

.ctl-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: #f1f5f9;
  color: #64748b;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.ctl-btn:hover {
  background: #e2e8f0;
  color: #1e293b;
}

.ctl-btn.stop {
  background: #ef4444;
  color: white;
}

.ctl-btn.stop:hover {
  background: #dc2626;
}

/* ===== Lyrics row: horizontal scroll single-line ===== */
.lyrics-row {
  padding: 0 10px 6px;
}

.lyrics-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scroll-behavior: smooth;
  font-size: 13px;
  line-height: 1.4;
  color: #334155;
  mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 8px), black);
  -webkit-mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 8px), black);
}

.lyrics-scroll::-webkit-scrollbar {
  display: none;
}

/* ===== Stopped state ===== */
.stopped-bar {
  border-bottom: 1px solid #f1f5f9;
}

.stopped-label {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
}

.spacer {
  flex: 1;
}

/* Collapsed preview */
.lyrics-row.preview {
  cursor: pointer;
  padding: 4px 10px 6px;
}

.lyrics-row.preview:hover {
  background: #f8fafc;
}

.preview-text {
  font-size: 13px;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Expanded editor */
.expanded-area {
  flex: 1;
  padding: 0 10px;
  min-height: 0;
  display: flex;
}

.text-editor {
  width: 100%;
  flex: 1;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  line-height: 1.5;
  color: #334155;
  resize: none;
  outline: none;
  font-family: inherit;
}

.text-editor:focus {
  border-color: var(--color-primary);
}

.text-editor::placeholder {
  color: #cbd5e1;
}

/* Action buttons */
.stopped-actions {
  display: flex;
  gap: 6px;
  padding: 6px 10px 8px;
  flex-shrink: 0;
}

.action-btn {
  flex: 1;
  height: 30px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn.abandon {
  flex: 0 0 56px;
  border: 1px solid #fecaca;
  color: #b91c1c;
  background: #fff7f7;
}

.action-btn.abandon:hover:not(:disabled) {
  background: #fee2e2;
}

.action-btn.resume {
  background: #f1f5f9;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.action-btn.resume:hover:not(:disabled) {
  background: #e2e8f0;
}

.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.abandon-confirmation {
  align-items: center;
}

.abandon-confirmation-text {
  flex: 1;
  color: #7f1d1d;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.action-btn.compact {
  flex: 0 0 auto;
  min-width: 54px;
  padding: 0 10px;
  color: #64748b;
  background: #f1f5f9;
}

.action-btn.abandon-confirm {
  min-width: 72px;
  color: #fff;
  background: #dc2626;
}

.action-btn.abandon-confirm:hover:not(:disabled) {
  background: #b91c1c;
}

.action-btn.confirm {
  background: var(--color-primary, #0891B2);
  color: white;
}

.action-btn.confirm:hover:not(:disabled) {
  filter: brightness(1.1);
}

.action-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== Processing state ===== */
.processing-state {
  display: flex;
  flex-direction: column;
  min-height: 96px;
}

.processing-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.processing-label {
  display: block;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.processing-dots {
  display: flex;
  gap: 4px;
  align-items: center;
  padding-left: 4px;
  flex-shrink: 0;
}

.processing-dots .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-primary, #0891B2);
  animation: dot-bounce 1.4s ease-in-out infinite;
}

.processing-dots .dot:nth-child(2) {
  animation-delay: 0.16s;
}

.processing-dots .dot:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes dot-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.2); }
}

.avatar-wrapper.processing-pulse::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--color-primary, #0891B2);
  opacity: 0;
  animation: pulse-ring 2s infinite;
}

.processing-bar-shell {
  padding: 0 12px 12px;
}

.processing-bar-track {
  height: 4px;
  background: #e2e8f0;
  overflow: hidden;
  border-radius: 999px;
}

.processing-bar-fill {
  height: 100%;
  width: 40%;
  background: var(--color-primary, #0891B2);
  border-radius: 2px;
  animation: progress-slide 1.5s ease-in-out infinite;
}

@keyframes progress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
</style>
