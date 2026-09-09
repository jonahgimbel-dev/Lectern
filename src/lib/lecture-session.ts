import { createCourse, saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, blobToWav, pcmToWav, pickRecorderMime } from "@/lib/wav";

const TARGET_RATE = 16_000;
const FLUSH_SEC = 3;
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
  bufferedSec: number;
  draft: { transcript: string; durationSec: number } | null;
};

const listeners = new Set<() => void>();
let snap: LectureSnap = idleSnap();

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let speech: SpeechRec | null = null;
let ticker: number | null = null;
let flusher: number | null = null;
let rotator: number | null = null;
let mime = "";
let startedAt = 0;
let pausedAccum = 0;
let pauseBegan = 0;
let liveCaptions = "";
let sttParts: string[] = [];
let pending: Promise<void> = Promise.resolve();
let generation = 0;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let sinkNode: MediaStreamAudioDestinationNode | null = null;
let timeBuf: Float32Array<ArrayBuffer> | null = null;
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
    status: "Hit rec when class starts.",
    courseId: "",
    hidden: false,
    hearing: false,
    levels: Array.from({ length: BAR_COUNT }, () => 0.08),
    lastError: "",
    bufferedSec: 0,
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
  recg.onerror = () => {
    /* STT still runs from the mic buffer */
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
  const hearing = rms > 0.004;
  const levels = Array.from({ length: BAR_COUNT }, (_, idx) => {
    const at = Math.min(input.length - 1, Math.floor((idx / BAR_COUNT) * input.length));
    return Math.min(1, Math.max(0.06, Math.abs(input[at] ?? 0) * 8));
  });
  const now = Date.now();
  if (hearing) quietSince = now;
  emit({
    hearing: hearing || (quietSince > 0 && now - quietSince < 1600),
    levels,
    bufferedSec: pcmLen / TARGET_RATE,
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

function transcribeWavBlob(wav: Blob, gen: number) {
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
      if (!spoken.ok) emit({ lastError: spoken.error, status: spoken.error });
    } catch (error) {
      emit({ lastError: error instanceof Error ? error.message : "Could not transcribe." });
    }
  });
}

function amplify(samples: Int16Array) {
  const p = peak(samples);
  if (p < 6) return samples;
  if (p >= 6000) return samples;
  const gain = Math.min(12, 6000 / p);
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = Math.max(-32767, Math.min(32767, Math.round((samples[i] ?? 0) * gain)));
  }
  return out;
}

function transcribePcm(samples: Int16Array) {
  if (samples.length < TARGET_RATE * 0.35) return;
  if (peak(samples) < 6) return;
  transcribeWavBlob(pcmToWav(amplify(samples), TARGET_RATE), generation);
}

function transcribeMedia(blob: Blob) {
  if (blob.size < 800) return;
  const gen = generation;
  pending = pending.then(async () => {
    if (gen !== generation) return;
    try {
      transcribeWavBlob(await blobToWav(blob), gen);
    } catch {
      /* PCM / captions remain */
    }
  });
}

function openRecorder() {
  if (!stream) return;
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const local: Blob[] = [];
  rec.ondataavailable = (event) => {
    if (event.data.size) local.push(event.data);
  };
  rec.onstop = () => {
    if (pcmLen < TARGET_RATE) {
      transcribeMedia(new Blob(local, { type: rec.mimeType || mime || "audio/webm" }));
    }
  };
  rec.start();
  recorder = rec;
}

function waitForStop() {
  const rec = recorder;
  if (!rec || rec.state === "inactive") return Promise.resolve();
  return new Promise<void>((resolve) => {
    rec.addEventListener("stop", () => resolve(), { once: true });
    try {
      rec.requestData();
      rec.stop();
    } catch {
      resolve();
    }
  });
}

function scheduleRotate() {
  if (rotator) window.clearTimeout(rotator);
  rotator = window.setTimeout(async () => {
    if (!snap.live || snap.paused) return;
    await waitForStop();
    if (snap.live && !snap.paused) {
      openRecorder();
      scheduleRotate();
    }
  }, FLUSH_SEC * 1000);
}

function flush(all = false) {
  const samples = takePcm(all);
  if (samples) transcribePcm(samples);
}

function attachCapture(nextStream: MediaStream, ctx: AudioContext) {
  const source = ctx.createMediaStreamSource(nextStream);
  const node = ctx.createAnalyser();
  node.fftSize = 2048;
  node.smoothingTimeConstant = 0;
  const sink = ctx.createMediaStreamDestination();
  source.connect(node);
  node.connect(sink);
  sourceNode = source;
  analyser = node;
  sinkNode = sink;
  audioCtx = ctx;
  timeBuf = new Float32Array(new ArrayBuffer(node.fftSize * 4));
}

function pullAnalyser() {
  if (!analyser || !timeBuf || !audioCtx || !snap.live || snap.paused) return;
  analyser.getFloatTimeDomainData(timeBuf);
  appendSamples(timeBuf, audioCtx.sampleRate);
}

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    pullAnalyser();
    const silent = elapsed() >= 2 && pcmLen < TARGET_RATE * 0.3;
    emit({
      hidden: document.hidden,
      bufferedSec: pcmLen / TARGET_RATE,
      status: snap.paused
        ? "Paused."
        : snap.lastError
          ? snap.lastError
          : document.hidden
            ? "Still recording in the background. Don’t close this tab."
            : snap.hearing
              ? "Hearing you · keep this tab open."
              : silent
                ? "Mic is on, but it’s silent. Check the input device in Chrome."
                : "Listening for your voice · keep this tab open.",
    });
  }, 40);
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
    analyser?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    sinkNode?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    sourceNode?.disconnect();
  } catch {
    /* ignore */
  }
  analyser = null;
  sinkNode = null;
  sourceNode = null;
  timeBuf = null;
  void audioCtx?.close().catch(() => undefined);
  audioCtx = null;
}

function hardStop() {
  generation += 1;
  if (flusher) window.clearInterval(flusher);
  flusher = null;
  if (rotator) window.clearTimeout(rotator);
  rotator = null;
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  stopSpeech();
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }
  recorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseGraph();
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

export async function startLecture(courseId = "") {
  if (snap.saving) return;
  if (snap.live || snap.starting) hardStop();

  sttParts = [];
  pending = Promise.resolve();
  liveCaptions = "";
  pcm = new Int16Array(FLUSH_SAMPLES * 2);
  pcmLen = 0;
  resamplePos = 0;
  mime = pickRecorderMime();
  startedAt = Date.now();
  pausedAccum = 0;
  pauseBegan = 0;
  quietSince = Date.now();
  generation += 1;

  // Same Rec click: audio graph + captions + mic request, no awaits yet.
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
    bufferedSec: 0,
  });
  startSpeech();
  const mic = navigator.mediaDevices.getUserMedia({ audio: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  tick();

  try {
    stream = await mic;
  } catch (error) {
    hardStop();
    emit({ ...idleSnap(), status: micError(error), lastError: micError(error) });
    throw new Error(micError(error));
  }

  void ctx.resume();
  try {
    attachCapture(stream, ctx);
  } catch {
    audioCtx = ctx;
  }
  try {
    openRecorder();
    scheduleRotate();
  } catch {
    /* captions + PCM still run */
  }
  if (!speech) startSpeech();
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
  if (rotator) window.clearTimeout(rotator);
  rotator = null;
  stopSpeech();
  flush(true);
  await waitForStop();
  recorder = null;
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
  const course = await ensureCourse(snap.courseId);
  if (!course.ok) {
    emit({ saving: false, draft: { transcript, durationSec }, status: "Couldn’t file it — tap save again." });
    return course;
  }
  emit({ courseId: course.id });
  const result = await saveLecture({
    data: { courseId: course.id, transcript, durationSec, source: "mic" },
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

async function ensureCourse(courseId: string) {
  if (courseId) return { ok: true as const, id: courseId };
  const created = await createCourse({ data: { name: "Inbox", code: "INBOX" } }).catch(() => null);
  if (!created?.ok) return { ok: false as const, error: "Could not file that lecture." };
  return { ok: true as const, id: created.id };
}

export function setLectureCourse(courseId: string) {
  emit({ courseId });
}

export async function saveTypedLecture(transcript: string, courseId?: string) {
  const text = transcript.trim();
  if (!text) return { ok: false as const, error: "Type a bit of what was said." };
  const course = await ensureCourse(courseId || snap.courseId);
  if (!course.ok) return course;
  emit({ saving: true, status: "Filing this lecture…", courseId: course.id });
  const result = await saveLecture({
    data: { courseId: course.id, transcript: text, durationSec: elapsed() || snap.seconds, source: "typed" },
  }).catch(() => ({ ok: false as const, error: "Could not save that lecture." }));
  emit({ saving: false });
  if (!result.ok) return result;
  emit({ ...idleSnap(), courseId: course.id });
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

export async function saveUploadedLecture(file: File, courseId?: string) {
  const course = await ensureCourse(courseId || snap.courseId);
  if (!course.ok) return course;
  emit({ saving: true, status: "Transcribing that file…", courseId: course.id });
  try {
    const wav = file.type.includes("wav") ? file : await blobToWav(file);
    const spoken = await transcribeAudio({
      data: {
        base64: await blobToBase64(wav),
        mimeType: "audio/wav",
        filename: "lecture.wav",
      },
    });
    if (!spoken.ok || !spoken.text) {
      emit({ saving: false, lastError: spoken.ok ? "No speech in that file." : spoken.error });
      return { ok: false as const, error: spoken.ok ? "No speech in that file." : spoken.error };
    }
    return saveTypedLecture(spoken.text, course.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that audio file.";
    emit({ saving: false, lastError: message });
    return { ok: false as const, error: message };
  }
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
    try {
      recorder?.resume();
    } catch {
      openRecorder();
      scheduleRotate();
    }
    emit({ paused: false, status: "Listening for your voice · keep this tab open." });
    startSpeech();
    void audioCtx?.resume();
    return;
  }
  if (rotator) window.clearTimeout(rotator);
  rotator = null;
  pauseBegan = Date.now();
  flush(true);
  try {
    recorder?.pause();
  } catch {
    void waitForStop();
  }
  stopSpeech();
  emit({ paused: true, status: "Paused.", hearing: false });
}

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
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
