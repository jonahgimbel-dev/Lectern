import { createCourse, saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, blobToWav, blobToWavSlices, pickRecorderMime } from "@/lib/wav";

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

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let speech: SpeechRec | null = null;
let ticker: number | null = null;
let startedAt = 0;
let pausedAccum = 0;
let pauseBegan = 0;
let chunks: Blob[] = [];
let mime = "";
let captions = "";
let wakeLock: WakeLockSentinel | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let sinkNode: MediaStreamAudioDestinationNode | null = null;
let timeBuf: Float32Array<ArrayBuffer> | null = null;

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
  snap = { ...snap, ...patch, seconds: elapsed() };
  bindDebug();
  listeners.forEach((fn) => fn());
}

function elapsed() {
  if (!startedAt) return snap.seconds;
  const extra = pauseBegan ? Date.now() - pauseBegan : 0;
  return Math.max(0, Math.floor((Date.now() - startedAt - pausedAccum - extra) / 1000));
}

function listeningCopy() {
  if (typeof document !== "undefined" && document.hidden) {
    return "Still recording in the background. Other sites are fine — don’t close this tab.";
  }
  return "Listening for your voice · keep this tab open.";
}

function bindDebug() {
  if (typeof window === "undefined") return;
  window.__lectern = { snap, pcmLen: chunks.length, parts: captions ? [captions] : [] };
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
    captions = text.trim();
    emit({ captions, hearing: true, lastError: "" });
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

function releaseAwake() {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  try {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "none";
  } catch {
    /* optional */
  }
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

function pullMeter() {
  const buf = timeBuf;
  if (!analyser || !buf || !snap.live || snap.paused) return;
  analyser.getFloatTimeDomainData(buf);
  let energy = 0;
  for (let i = 0; i < buf.length; i += 1) energy += buf[i] * buf[i];
  const rms = Math.sqrt(energy / Math.max(1, buf.length));
  const hearing = rms > 0.004 || Boolean(captions);
  const levels = Array.from({ length: BAR_COUNT }, (_, idx) => {
    const at = Math.min(buf.length - 1, Math.floor((idx / BAR_COUNT) * buf.length));
    return Math.min(1, Math.max(0.06, Math.abs(buf[at] ?? 0) * 8));
  });
  emit({
    hearing,
    levels,
    bufferedSec: chunks.reduce((sum, part) => sum + part.size, 0) / 16_000,
  });
}

function attachMeter(nextStream: MediaStream) {
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    const source = ctx.createMediaStreamSource(nextStream);
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0;
    const sink = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(sink);
    audioCtx = ctx;
    sourceNode = source;
    analyser = node;
    sinkNode = sink;
    timeBuf = new Float32Array(new ArrayBuffer(node.fftSize * 4));
  } catch {
    /* captions and MediaRecorder still run */
  }
}

function releaseMeter() {
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

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    pullMeter();
    emit({ hidden: document.hidden, status: snap.paused ? "Paused." : snap.lastError || listeningCopy() });
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
    void holdAwake();
    void audioCtx?.resume();
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!snap.live && !snap.saving) return;
  event.preventDefault();
  event.returnValue = "";
}

async function transcribeBlob(blob: Blob) {
  const parts: string[] = [];
  try {
    const slices = await blobToWavSlices(blob);
    for (const slice of slices) {
      const spoken = await transcribeAudio({
        data: {
          base64: await blobToBase64(slice),
          mimeType: "audio/wav",
          filename: "lecture.wav",
        },
      });
      if (spoken.ok && spoken.text) parts.push(spoken.text.trim());
      else if (!spoken.ok) emit({ lastError: spoken.error });
    }
  } catch {
    try {
      const spoken = await transcribeAudio({
        data: {
          base64: await blobToBase64(blob),
          mimeType: blob.type || "audio/webm",
          filename: "lecture.webm",
        },
      });
      if (spoken.ok && spoken.text) parts.push(spoken.text.trim());
    } catch {
      /* captions remain */
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
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

export async function startLecture(courseId = "") {
  if (snap.saving) return;
  if (snap.live || snap.starting) return;

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
    bufferedSec: 0,
    status: "Allow the microphone…",
    seconds: 0,
  });

  let nextStream: MediaStream;
  try {
    nextStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    emit({ ...idleSnap(), status: micError(error), lastError: micError(error) });
    throw new Error(micError(error));
  }

  stream = nextStream;
  mime = pickRecorderMime();
  chunks = [];
  captions = "";
  startedAt = Date.now();
  pausedAccum = 0;
  pauseBegan = 0;
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  rec.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  rec.start(1000);
  recorder = rec;
  attachMeter(nextStream);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  emit({
    live: true,
    starting: false,
    paused: false,
    saving: false,
    courseId,
    captions: "",
    draft: null,
    hidden: document.hidden,
    status: listeningCopy(),
    seconds: 0,
  });
  await holdAwake();
  startSpeech();
  tick();
}

export async function saveLectureSession() {
  if (snap.saving) return { ok: false as const, error: "Already saving." };
  if (!snap.live && !snap.draft) return { ok: false as const, error: "Nothing to save." };
  emit({ saving: true, status: "Wrapping up audio…" });
  stopSpeech();
  await waitForStop();
  recorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseAwake();
  releaseMeter();
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
  const durationSec = elapsed();
  startedAt = 0;
  const blob = new Blob(chunks, { type: mime || "audio/webm" });
  emit({ live: false, paused: false, status: "Transcribing…" });
  const spoken = blob.size > 500 ? await transcribeBlob(blob) : "";
  const transcript = spoken || captions.trim();
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
  captions = "";
  chunks = [];
  emit({ ...idleSnap(), courseId: course.id });
  return result;
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
  const course = await ensureCourse(snap.courseId);
  if (!course.ok) {
    emit({ saving: false });
    return course;
  }
  const result = await saveLecture({
    data: { courseId: course.id, transcript: draft.transcript, durationSec: draft.durationSec, source: "mic" },
  }).catch(() => ({ ok: false as const, error: "Could not save that lecture." }));
  emit({ saving: false });
  if (!result.ok) return result;
  emit({ ...idleSnap(), courseId: course.id });
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
  releaseAwake();
  releaseMeter();
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
  chunks = [];
  captions = "";
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
      /* ignore */
    }
    emit({ paused: false, status: listeningCopy() });
    startSpeech();
    void holdAwake();
    void audioCtx?.resume();
    return;
  }
  pauseBegan = Date.now();
  try {
    recorder?.pause();
  } catch {
    /* some browsers lack pause */
  }
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
