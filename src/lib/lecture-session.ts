import { saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, pcmToWav } from "@/lib/wav";

const TARGET_RATE = 16_000;
const FLUSH_SEC = 12;
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
let wakeLock: WakeLockSentinel | null = null;
let audioCtx: AudioContext | null = null;
let captureNode: AudioNode | null = null;
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
    draft: null,
  };
}

function emit(patch: Partial<LectureSnap> = {}) {
  const next = { ...snap, ...patch };
  if (patch.seconds === undefined) next.seconds = elapsed();
  if (patch.captions === undefined) next.captions = shownText();
  snap = next;
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
  if (spoken && live && !spoken.includes(live) && live.length > 12) {
    return `${spoken} ${live}`.replace(/\s+/g, " ");
  }
  return spoken || live;
}

function listeningCopy() {
  if (typeof document !== "undefined" && document.hidden) {
    return "Still recording in the background. Other sites are fine — don’t close this tab.";
  }
  if (snap.hearing) return "Hearing you · keep this tab open.";
  return "Listening for your voice · keep this tab open.";
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

function stopSpeech() {
  try {
    speech?.stop();
  } catch {
    /* already stopped */
  }
  speech = null;
}

function startSpeech() {
  if (typeof document !== "undefined" && document.hidden) return;
  const SpeechApi = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechApi) return;
  const recg = new SpeechApi();
  recg.continuous = true;
  recg.interimResults = true;
  recg.lang = "en-US";
  recg.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i += 1) text += `${event.results[i][0].transcript} `;
    liveCaptions = text.trim();
    emit({ captions: shownText() });
  };
  recg.onend = () => {
    if (snap.live && !snap.paused && !document.hidden) {
      try {
        recg.start();
      } catch {
        /* restart races */
      }
    }
  };
  try {
    recg.start();
    speech = recg;
  } catch {
    speech = null;
  }
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
  const hearing = rms > 0.012;
  const levels = Array.from({ length: BAR_COUNT }, (_, idx) => {
    const at = Math.floor((idx / BAR_COUNT) * input.length);
    return Math.min(1, Math.max(0.06, Math.abs(input[at] ?? 0) * 4));
  });
  const now = Date.now();
  if (hearing) quietSince = now;
  emit({
    hearing: hearing || (quietSince > 0 && now - quietSince < 1600),
    levels,
  });
}

async function attachCapture(nextStream: MediaStream) {
  void audioCtx?.close().catch(() => undefined);
  const ctx = new AudioContext();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(nextStream);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  audioCtx = ctx;
  sourceNode = source;
  resamplePos = 0;

  try {
    const blob = new Blob(
      [
        `class LecternCapture extends AudioWorkletProcessor{process(inputs){const ch=inputs[0]&&inputs[0][0];if(ch&&ch.length)this.port.postMessage(ch.slice());return true}}registerProcessor('lectern-cap',LecternCapture)`,
      ],
      { type: "application/javascript" },
    );
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, "lectern-cap");
    node.port.onmessage = (event) => {
      const data = event.data;
      if (data instanceof Float32Array) appendSamples(data, ctx.sampleRate);
      else if (data instanceof ArrayBuffer) appendSamples(new Float32Array(data), ctx.sampleRate);
    };
    source.connect(node);
    node.connect(mute);
    captureNode = node;
    return;
  } catch {
    /* ScriptProcessor fallback */
  }

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    appendSamples(new Float32Array(event.inputBuffer.getChannelData(0)), ctx.sampleRate);
  };
  source.connect(processor);
  processor.connect(mute);
  captureNode = processor;
}

function takePcm(all: boolean) {
  const min = all ? TARGET_RATE * 0.35 : FLUSH_SAMPLES;
  if (pcmLen < min) return all && pcmLen >= TARGET_RATE * 0.25 ? pcm.slice(0, pcmLen) : null;
  const count = all ? pcmLen : FLUSH_SAMPLES;
  const slice = pcm.slice(0, count);
  const rest = pcm.slice(count, pcmLen);
  pcm = new Int16Array(Math.max(FLUSH_SAMPLES * 2, rest.length + FLUSH_SAMPLES));
  pcm.set(rest);
  pcmLen = rest.length;
  return slice;
}

function transcribePcm(samples: Int16Array) {
  if (samples.length < TARGET_RATE * 0.25) return;
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
        emit({ captions: shownText() });
      }
    } catch {
      /* captions remain */
    }
  });
}

function flush(all = false) {
  const samples = takePcm(all);
  if (samples) transcribePcm(samples);
}

async function holdAwake() {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    wakeLock = null;
  }
  try {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Lectern is recording",
      artist: "Leave this tab open in the background",
    });
    navigator.mediaSession.playbackState = "playing";
  } catch {
    /* optional */
  }
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
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  try {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "none";
  } catch {
    /* optional */
  }
}

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    emit({
      hidden: typeof document !== "undefined" && document.hidden,
      status: snap.paused ? "Paused." : snap.hearing ? listeningCopy() : "Too quiet — talk closer to the mic.",
    });
  }, 250);
}

function onVisibility() {
  emit({ hidden: document.hidden, status: snap.live && !snap.paused ? listeningCopy() : snap.status });
  if (document.hidden) {
    stopSpeech();
    return;
  }
  if (snap.live && !snap.paused) {
    startSpeech();
    void audioCtx?.resume();
    void holdAwake();
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!snap.live && !snap.saving) return;
  event.preventDefault();
  event.returnValue = "";
}

function stopTimers() {
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  if (flusher) window.clearInterval(flusher);
  flusher = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

export async function startLecture(courseId: string) {
  if (snap.saving || snap.starting) return;
  if (snap.live) return;
  if (!courseId) throw new Error("Pick a class first.");
  emit({ starting: true, courseId, status: "Allow the microphone…" });
  const mic = navigator.mediaDevices.getUserMedia({ audio: true });
  const nextStream = await Promise.race([
    mic,
    new Promise<MediaStream>((_, reject) => {
      window.setTimeout(() => reject(new Error("Microphone timed out. Allow access, then hit Rec.")), 45_000);
    }),
  ]).catch((error) => {
    emit({ starting: false, status: micError(error) });
    throw new Error(micError(error));
  });
  generation += 1;
  stream = nextStream;
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
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  await attachCapture(nextStream);
  emit({
    live: true,
    paused: false,
    starting: false,
    saving: false,
    courseId,
    captions: "",
    draft: null,
    hidden: document.hidden,
    hearing: false,
    status: "Listening for your voice · keep this tab open.",
    seconds: 0,
  });
  await holdAwake();
  startSpeech();
  tick();
  flusher = window.setInterval(() => {
    if (snap.live && !snap.paused) flush(false);
  }, FLUSH_SEC * 1000);
}

export async function saveLectureSession() {
  if (snap.saving) return { ok: false as const, error: "Already saving." };
  if (!snap.live && !snap.draft) return { ok: false as const, error: "Nothing to save." };
  emit({ saving: true, status: "Wrapping up audio…" });
  const durationSec = elapsed();
  generation += 1;
  stopSpeech();
  flush(true);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseGraph();
  stopTimers();
  startedAt = 0;
  emit({ live: false, paused: false, status: "Transcribing…" });
  await pending;
  const transcript = shownText().trim();
  if (!transcript) {
    emit({
      saving: false,
      draft: null,
      starting: false,
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
  generation += 1;
  stopSpeech();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseGraph();
  stopTimers();
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
    void holdAwake();
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
  }
}
