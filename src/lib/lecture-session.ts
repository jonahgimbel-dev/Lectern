import { saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, blobToWav, pickRecorderMime } from "@/lib/wav";

const SEGMENT_MS = 20_000;
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

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let speech: SpeechRec | null = null;
let ticker: number | null = null;
let rotator: number | null = null;
let startedAt = 0;
let pausedAccum = 0;
let pauseBegan = 0;
let mime = "";
let liveCaptions = "";
let sttParts: string[] = [];
let pending: Promise<void>[] = [];
let generation = 0;
let wakeLock: WakeLockSentinel | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
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
  if (spoken && live) {
    const extra = live.length > spoken.length ? live.slice(spoken.length).trim() : live;
    return extra && !spoken.includes(extra) ? `${spoken} ${extra}`.replace(/\s+/g, " ") : spoken;
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

function attachMeter(nextStream: MediaStream) {
  void audioCtx?.close().catch(() => undefined);
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(nextStream);
    const node = ctx.createAnalyser();
    node.fftSize = 64;
    node.smoothingTimeConstant = 0.7;
    source.connect(node);
    audioCtx = ctx;
    analyser = node;
    void ctx.resume();
  } catch {
    analyser = null;
    audioCtx = null;
  }
}

function readLevels() {
  if (!analyser) return { levels: snap.levels, hearing: false };
  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const levels = Array.from({ length: BAR_COUNT }, (_, i) => {
    const idx = Math.min(bins.length - 1, Math.floor((i / BAR_COUNT) * bins.length));
    return Math.max(0.06, bins[idx] / 255);
  });
  const rms = bins.reduce((sum, value) => sum + value, 0) / (bins.length * 255);
  return { levels, hearing: rms > 0.045 };
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
  void audioCtx?.close().catch(() => undefined);
  audioCtx = null;
  analyser = null;
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

function transcribeClip(blob: Blob) {
  if (blob.size < 800) return;
  const job = (async () => {
    try {
      let payload = blob;
      let filename = mime.includes("mp4") ? "lecture.m4a" : "lecture.webm";
      let mimeType = blob.type || "audio/webm";
      try {
        payload = await blobToWav(blob);
        filename = "lecture.wav";
        mimeType = "audio/wav";
      } catch {
        /* send original complete file */
      }
      if (payload.size > 4_400_000) return;
      const spoken = await transcribeAudio({
        data: {
          base64: await blobToBase64(payload),
          mimeType,
          filename,
        },
      });
      if (spoken.ok && spoken.text) {
        sttParts = [...sttParts, spoken.text.trim()];
        emit({ captions: shownText() });
      }
    } catch {
      /* live captions remain */
    }
  })();
  pending = [...pending, job];
}

function openRecorder() {
  if (!stream || !snap.live || snap.paused) return;
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const local: Blob[] = [];
  rec.ondataavailable = (event) => {
    if (event.data.size) local.push(event.data);
  };
  rec.onstop = () => {
    const blob = new Blob(local, { type: rec.mimeType || mime || "audio/webm" });
    transcribeClip(blob);
  };
  rec.start();
  recorder = rec;
  if (rotator) window.clearTimeout(rotator);
  rotator = window.setTimeout(() => {
    if (generation && snap.live && !snap.paused) rotate();
  }, SEGMENT_MS);
}

function rotate() {
  if (!stream || !snap.live || snap.paused) return;
  const current = recorder;
  openRecorder();
  if (current && current.state !== "inactive") {
    try {
      current.stop();
    } catch {
      /* ignore */
    }
  }
}

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    const { levels, hearing } = readLevels();
    const now = Date.now();
    if (hearing) quietSince = now;
    const stillHearing = hearing || (quietSince > 0 && now - quietSince < 1600);
    emit({
      hidden: typeof document !== "undefined" && document.hidden,
      hearing: stillHearing,
      levels,
      status: snap.paused ? "Paused." : stillHearing ? listeningCopy() : "Too quiet — talk closer to the mic.",
    });
  }, 120);
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
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!snap.live && !snap.saving) return;
  event.preventDefault();
  event.returnValue = "";
}

function teardown() {
  generation += 1;
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
  releaseAwake();
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

export async function startLecture(courseId: string) {
  if (snap.saving || snap.starting) return;
  if (snap.live && recorder && recorder.state !== "inactive") return;
  if (!courseId) throw new Error("Pick a class first.");
  if (typeof MediaRecorder === "undefined") throw new Error("This browser can’t record audio. Try Chrome.");
  emit({ starting: true, courseId, status: "Allow the microphone…" });
  const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error) => {
    emit({ starting: false, status: micError(error) });
    throw new Error(micError(error));
  });
  generation += 1;
  stream = nextStream;
  mime = pickRecorderMime();
  sttParts = [];
  pending = [];
  liveCaptions = "";
  startedAt = Date.now();
  pausedAccum = 0;
  pauseBegan = 0;
  quietSince = Date.now();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  attachMeter(nextStream);
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
  openRecorder();
  await holdAwake();
  startSpeech();
  tick();
}

export async function saveLectureSession() {
  if (snap.saving) return { ok: false as const, error: "Already saving." };
  if (!snap.live && !snap.draft) return { ok: false as const, error: "Nothing to save." };
  emit({ saving: true, status: "Wrapping up audio…" });
  const durationSec = elapsed();
  generation += 1;
  if (rotator) window.clearTimeout(rotator);
  rotator = null;
  stopSpeech();
  await waitForStop();
  recorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseAwake();
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("beforeunload", onBeforeUnload);
  startedAt = 0;
  emit({ live: false, paused: false, status: "Transcribing…" });
  await new Promise((resolve) => window.setTimeout(resolve, 50));
  await Promise.all(pending);
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
  pending = [];
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
  teardown();
  sttParts = [];
  liveCaptions = "";
  pending = [];
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
    openRecorder();
    startSpeech();
    void holdAwake();
    return;
  }
  if (rotator) window.clearTimeout(rotator);
  rotator = null;
  pauseBegan = Date.now();
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      /* some browsers lack pause */
    }
  }
  recorder = null;
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
