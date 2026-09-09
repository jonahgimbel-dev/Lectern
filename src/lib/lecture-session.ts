import { saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, pcmToWav } from "@/lib/wav";

const TARGET_RATE = 16_000;
const FLUSH_SEC = 4;
const FLUSH_SAMPLES = TARGET_RATE * FLUSH_SEC;
const BAR_COUNT = 24;

export type LectureSnap = {
  live: boolean;
  paused: boolean;
  starting: boolean;
  saving: boolean;
  seconds: number;
  captions: string;
  status: string;
  courseId: string;
  hidden: boolean;
  hearing: boolean;
  levels: number[];
  lastError: string;
  draft: { transcript: string; durationSec: number } | null;
};

const listeners = new Set<() => void>();
let snap: LectureSnap = idleSnap();

let stream: MediaStream | null = null;
let speech: SpeechRec | null = null;
let ticker: number | null = null;
let flusher: number | null = null;
let startedAt = 0;
let pausedAccum = 0;
let pauseBegan = 0;
let liveCaptions = "";
let sttParts: string[] = [];
let pending: Promise<void> = Promise.resolve();
let generation = 0;
let audioCtx: AudioContext | null = null;
let captureNode: ScriptProcessorNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let pcm = new Int16Array(FLUSH_SAMPLES * 2);
let pcmLen = 0;
let resamplePos = 0;
let quietSince = 0;

function idleSnap(): LectureSnap {
  return {
    live: false,
    paused: false,
    starting: false,
    saving: false,
    seconds: 0,
    captions: "",
    status: "Pick a class, then hit rec.",
    courseId: "",
    hidden: false,
    hearing: false,
    levels: Array.from({ length: BAR_COUNT }, () => 0.08),
    lastError: "",
    draft: null,
  };
}

function emit(patch: Partial<LectureSnap> = {}) {
  const next = { ...snap, ...patch };
  if (patch.seconds === undefined) next.seconds = elapsed();
  if (patch.captions === undefined) next.captions = shownText();
  snap = next;
  bindDebug();
  listeners.forEach((fn) => fn());
}

function elapsed() {
  if (!startedAt) return snap.seconds;
  const extra = pauseBegan ? Date.now() - pauseBegan : 0;
  return Math.max(0, Math.floor((Date.now() - startedAt - pausedAccum - extra) / 1000));
}

function shownText() {
  const spoken = sttParts.map((part) => part.trim()).filter(Boolean).join(" ");
  const live = liveCaptions.trim();
  if (spoken && live && !spoken.includes(live) && live.split(/\s+/).length > 2) {
    return `${spoken} ${live}`.replace(/\s+/g, " ");
  }
  return spoken || live;
}

function bindDebug() {
  if (typeof window === "undefined") return;
  window.__lectern = {
    snap,
    pcmLen,
    parts: sttParts,
  };
}

export function getLectureSession() {
  return snap;
}

export function subscribeLectureSession(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function micError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Allow the microphone, then hit Rec again.";
  }
  if (name === "NotFoundError") return "No microphone found.";
  if (name === "NotReadableError") return "The mic is busy in another app. Close that, then retry.";
  if (error instanceof Error && error.message) return error.message;
  return "Could not start the microphone.";
}

function startSpeech() {
  const SpeechApi = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechApi) return;
  try {
    speech?.stop();
  } catch {
    /* ignore */
  }
  const recg = new SpeechApi();
  recg.continuous = true;
  recg.interimResults = true;
  recg.lang = "en-US";
  recg.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i += 1) text += `${event.results[i][0].transcript} `;
    liveCaptions = text.trim();
    emit({ captions: shownText(), hearing: true });
  };
  recg.onend = () => {
    if (snap.live && !snap.paused && !document.hidden) {
      window.setTimeout(() => {
        if (!snap.live || snap.paused || document.hidden) return;
        try {
          recg.start();
        } catch {
          /* recorder still captures PCM */
        }
      }, 250);
    }
  };
  try {
    recg.start();
    speech = recg;
  } catch {
    speech = null;
  }
}

function stopSpeech() {
  try {
    speech?.stop();
  } catch {
    /* ignore */
  }
  speech = null;
}

function appendSamples(input: Float32Array, fromRate: number) {
  if (!snap.live || snap.paused) return;
  const ratio = fromRate / TARGET_RATE;
  let i = resamplePos;
  while (i < input.length) {
    if (pcmLen >= pcm.length) {
      const grown = new Int16Array(pcm.length * 2);
      grown.set(pcm);
      pcm = grown;
    }
    const sample = Math.max(-1, Math.min(1, input[Math.floor(i)] ?? 0));
    pcm[pcmLen] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    pcmLen += 1;
    i += ratio;
  }
  resamplePos = i - input.length;

  let energy = 0;
  for (let n = 0; n < input.length; n += 1) energy += input[n] * input[n];
  const rms = Math.sqrt(energy / Math.max(1, input.length));
  const hearing = rms > 0.01;
  const levels = Array.from({ length: BAR_COUNT }, (_, idx) => {
    const at = Math.min(input.length - 1, Math.floor((idx / BAR_COUNT) * input.length));
    return Math.min(1, Math.max(0.06, Math.abs(input[at] ?? 0) * 5));
  });
  const now = Date.now();
  if (hearing) quietSince = now;
  emit({
    hearing: hearing || (quietSince > 0 && now - quietSince < 1600),
    levels,
  });
}

function takePcm(all: boolean) {
  const min = all ? Math.floor(TARGET_RATE * 0.4) : FLUSH_SAMPLES;
  if (pcmLen < min) return null;
  const count = all ? pcmLen : FLUSH_SAMPLES;
  const slice = pcm.slice(0, count);
  const rest = pcm.slice(count, pcmLen);
  pcm = new Int16Array(Math.max(FLUSH_SAMPLES * 2, rest.length + FLUSH_SAMPLES));
  pcm.set(rest);
  pcmLen = rest.length;
  return slice;
}

function peak(samples: Int16Array) {
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) max = Math.max(max, Math.abs(samples[i] ?? 0));
  return max;
}

function transcribePcm(samples: Int16Array) {
  if (samples.length < TARGET_RATE * 0.4) return;
  if (peak(samples) < 80) return;
  const wav = pcmToWav(samples, TARGET_RATE);
  const gen = generation;
  pending = pending.then(async () => {
    if (gen !== generation) return;
    try {
      const spoken = await transcribeAudio({
        data: {
          base64: await blobToBase64(wav),
          mimeType: "audio/wav",
          filename: "lecture.wav",
        },
      });
      if (gen !== generation) return;
      if (spoken.ok && spoken.text) {
        sttParts = [...sttParts, spoken.text.trim()];
        emit({ captions: shownText(), lastError: "" });
        return;
      }
      emit({ lastError: spoken.ok ? "" : spoken.error, status: spoken.ok ? snap.status : spoken.error });
    } catch (error) {
      emit({ lastError: error instanceof Error ? error.message : "Could not transcribe." });
    }
  });
}

function flush(all = false) {
  const samples = takePcm(all);
  if (samples) transcribePcm(samples);
}

function attachCapture(nextStream: MediaStream, ctx: AudioContext) {
  const source = ctx.createMediaStreamSource(nextStream);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    appendSamples(new Float32Array(event.inputBuffer.getChannelData(0)), ctx.sampleRate);
  };
  source.connect(processor);
  processor.connect(mute);
  sourceNode = source;
  captureNode = processor;
  audioCtx = ctx;
}

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    emit({
      hidden: document.hidden,
      status: snap.paused
        ? "Paused."
        : snap.lastError
          ? snap.lastError
          : document.hidden
            ? "Still recording in the background. Don’t close this tab."
            : snap.hearing
              ? "Hearing you · keep this tab open."
              : "Listening for your voice · keep this tab open.",
    });
  }, 250);
}

function onVisibility() {
  if (document.hidden) {
    stopSpeech();
    emit({ hidden: true });
    return;
  }
  emit({ hidden: false });
  if (snap.live && !snap.paused) {
    startSpeech();
    void audioCtx?.resume();
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!snap.live && !snap.saving) return;
  event.preventDefault();
  event.returnValue = "";
}

function releaseGraph() {
  try {
    captureNode?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    sourceNode?.disconnect();
  } catch {
    /* ignore */
  }
  captureNode = null;
  sourceNode = null;
  void audioCtx?.close().catch(() => undefined);
  audioCtx = null;
}

function hardStop() {
  generation += 1;
  if (flusher) window.clearInterval(flusher);
  flusher = null;
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  stopSpeech();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseGraph();
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

export async function startLecture(courseId: string) {
  if (!courseId) throw new Error("Pick a class first.");
  if (snap.saving) return;
  if (snap.live || snap.starting) hardStop();

  sttParts = [];
  pending = Promise.resolve();
  liveCaptions = "";
  pcm = new Int16Array(FLUSH_SAMPLES * 2);
  pcmLen = 0;
  resamplePos = 0;
  startedAt = Date.now();
  pausedAccum = 0;
  pauseBegan = 0;
  quietSince = Date.now();
  generation += 1;

  const ctx = new AudioContext();
  void ctx.resume();
  emit({
    live: true,
    starting: true,
    paused: false,
    saving: false,
    courseId,
    captions: "",
    draft: null,
    hidden: false,
    hearing: false,
    lastError: "",
    status: "Allow the microphone…",
    seconds: 0,
  });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  tick();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    hardStop();
    emit({ ...idleSnap(), status: micError(error), lastError: micError(error) });
    throw new Error(micError(error));
  }

  await ctx.resume();
  attachCapture(stream, ctx);
  startSpeech();
  flusher = window.setInterval(() => {
    if (snap.live && !snap.paused) flush(false);
  }, FLUSH_SEC * 1000);
  emit({
    starting: false,
    live: true,
    status: "Listening for your voice · keep this tab open.",
  });
}

export async function saveLectureSession() {
  if (snap.saving) return { ok: false as const, error: "Already saving." };
  if (!snap.live && !snap.draft) return { ok: false as const, error: "Nothing to save." };
  emit({ saving: true, status: "Wrapping up audio…" });
  const durationSec = elapsed();
  const gen = generation;
  if (flusher) window.clearInterval(flusher);
  flusher = null;
  stopSpeech();
  flush(true);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseGraph();
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
  startedAt = 0;
  emit({ live: false, paused: false, status: "Transcribing…" });
  await pending;
  if (gen !== generation) return { ok: false as const, error: "Recording was discarded." };
  const transcript = shownText().trim();
  if (!transcript) {
    emit({
      saving: false,
      starting: false,
      lastError: snap.lastError || "No speech captured.",
      status: "No speech captured. Talk closer to the mic, or type what was said below.",
    });
    return { ok: false as const, error: "No speech captured. Try again closer to the mic." };
  }
  emit({ status: "Filing this lecture…" });
  const result = await saveLecture({
    data: { courseId: snap.courseId, transcript, durationSec, source: "mic" },
  }).catch(() => ({ ok: false as const, error: "Could not save that lecture." }));
  if (!result.ok) {
    emit({ saving: false, draft: { transcript, durationSec }, status: "Couldn’t file it — tap save again." });
    return result;
  }
  sttParts = [];
  liveCaptions = "";
  pcmLen = 0;
  emit({ ...idleSnap(), courseId: snap.courseId });
  return result;
}

export async function saveTypedLecture(transcript: string, courseId?: string) {
  const text = transcript.trim();
  if (!text) return { ok: false as const, error: "Type a bit of what was said." };
  const id = courseId || snap.courseId;
  if (!id) return { ok: false as const, error: "Pick a class first." };
  emit({ saving: true, status: "Filing this lecture…", courseId: id });
  const result = await saveLecture({
    data: { courseId: id, transcript: text, durationSec: elapsed() || snap.seconds, source: "typed" },
  }).catch(() => ({ ok: false as const, error: "Could not save that lecture." }));
  emit({ saving: false });
  if (!result.ok) return result;
  emit({ ...idleSnap(), courseId: id });
  return result;
}

export async function saveDraftAgain() {
  const draft = snap.draft;
  if (!draft) return { ok: false as const, error: "Nothing to save." };
  emit({ saving: true, status: "Filing this lecture…" });
  const result = await saveLecture({
    data: { courseId: snap.courseId, transcript: draft.transcript, durationSec: draft.durationSec, source: "mic" },
  }).catch(() => ({ ok: false as const, error: "Could not save that lecture." }));
  emit({ saving: false });
  if (!result.ok) return result;
  emit({ ...idleSnap(), courseId: snap.courseId });
  return result;
}

export function discardLecture() {
  hardStop();
  sttParts = [];
  liveCaptions = "";
  pending = Promise.resolve();
  pcmLen = 0;
  startedAt = 0;
  pausedAccum = 0;
  pauseBegan = 0;
  emit(idleSnap());
}

export function togglePause() {
  if (!snap.live) return;
  if (snap.paused) {
    if (pauseBegan) pausedAccum += Date.now() - pauseBegan;
    pauseBegan = 0;
    emit({ paused: false, status: "Listening for your voice · keep this tab open." });
    startSpeech();
    void audioCtx?.resume();
    return;
  }
  pauseBegan = Date.now();
  flush(true);
  stopSpeech();
  emit({ paused: true, status: "Paused.", hearing: false });
}

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
    __lectern?: { snap: LectureSnap; pcmLen: number; parts: string[] };
  }
}
