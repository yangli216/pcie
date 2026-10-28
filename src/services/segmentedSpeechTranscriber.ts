interface SegmentedSpeechOptions {
  sampleRate: number;
  segmentDurationMs: number;
  transcribe: (audio: Blob) => Promise<string>;
  onText: (text: string) => void;
  onError?: (error: unknown) => void;
}

function comparable(text: string) {
  const values: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const character of text) {
    if (!/[\s，。！？、,.!?;；:："'“”‘’]/u.test(character)) {
      values.push(character.toLowerCase());
      offsets.push(offset);
    }
    offset += character.length;
  }
  return { values, offsets };
}

/** Conservative overlap removal for provisional text; the full recording supplies the final answer. */
export function mergeSpeechSegments(previous: string, next: string): string {
  next = next.trim();
  if (!next) return previous;
  if (!previous) return next;
  const left = comparable(previous);
  const right = comparable(next);
  for (let size = Math.min(left.values.length, right.values.length, 100); size >= 2; size--) {
    if (left.values.slice(-size).join('') === right.values.slice(0, size).join('')) {
      return previous.slice(0, left.offsets[left.values.length - size]) + next;
    }
  }
  const separator = /[a-z0-9]$/i.test(previous) && /^[a-z0-9]/i.test(next) ? ' ' : '';
  return previous + separator + next;
}

/** One request at a time; at most two segments await recognition, independently of the full recording. */
export class SegmentedSpeechTranscriber {
  private active = true;
  private running = false;
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private tail = new Int16Array(0);
  private droppedPending = false;
  private text = '';
  private readonly segmentSamples: number;
  private readonly overlapSamples: number;

  constructor(private readonly options: SegmentedSpeechOptions) {
    this.segmentSamples = Math.floor(options.sampleRate * options.segmentDurationMs / 1000);
    this.overlapSamples = Math.floor(options.sampleRate / 2);
  }

  push(pcm: Int16Array): void {
    if (!this.active || pcm.length === 0) return;
    this.pending.push(pcm);
    this.pendingSamples += pcm.length;
    const limit = this.segmentSamples * 2;
    while (this.pendingSamples > limit) {
      const excess = this.pendingSamples - limit;
      const first = this.pending[0];
      const remove = Math.min(excess, first.length);
      if (remove === first.length) this.pending.shift();
      else this.pending[0] = first.slice(remove);
      this.pendingSamples -= remove;
      this.droppedPending = true;
    }
    this.recognizeIfReady();
  }

  close(): void {
    this.active = false;
    this.pending = [];
    this.pendingSamples = 0;
    this.tail = new Int16Array(0);
  }

  private recognizeIfReady(): void {
    if (!this.active || this.running || this.pendingSamples < this.segmentSamples) return;
    const overlap = this.droppedPending ? new Int16Array(0) : this.tail;
    const audio = new Int16Array(overlap.length + this.pendingSamples);
    audio.set(overlap);
    let offset = overlap.length;
    for (const chunk of this.pending) { audio.set(chunk, offset); offset += chunk.length; }
    this.pending = [];
    this.pendingSamples = 0;
    this.droppedPending = false;
    this.tail = audio.slice(-this.overlapSamples);
    this.running = true;
    const blob = new Blob([audio.buffer], { type: 'audio/pcm' });
    void Promise.resolve().then(() => {
      if (!this.active) return '';
      return this.options.transcribe(blob);
    }).then(result => {
      if (!this.active) return;
      this.text = mergeSpeechSegments(this.text, result);
      if (result.trim()) this.options.onText(this.text);
    }).catch(error => {
      if (this.active) this.options.onError?.(error);
    }).finally(() => {
      this.running = false;
      this.recognizeIfReady();
    });
  }
}
