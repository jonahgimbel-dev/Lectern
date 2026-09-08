import { saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, blobToWavSlices, pickRecorderMime } from "@/lib/wav";

export type LectureSnap = {
  live: boolean;
  paused: boolean;
  saving: boolean;
  seconds: number;
  captions: string;
  status: string;
  courseId: string;
  hidden: boolean;
  draft: { transcript: string; durationSec: number } | null;
};

const listeners = new Set<() => void>();

let snap: LectureSnap = {
  live: false,
  paused: false,
  saving: false,
  seconds: 0,
  captions: "",
  status: "Listening for your voice · keep this tab open.",
  courseId: "",
  hidden: false,
  draft: null,
};

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

function emit(patch: Partial<LectureSnap> = {}) {
  snap = { ...snap, ...patch, seconds: elapsed() };
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
    for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript + " ";
    captions = text.trim();
    emit({ captions });
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

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    emit({ hidden: document.hidden });
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
  }
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

export async function startLecture(courseId: string) {
  if (snap.live) return;
  if (!courseId) throw new Error("Pick a class first.");
  const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error) => {
    throw new Error(micError(error));
  });
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
  document.addEventListener("visibilitychange", onVisibility);
  emit({
    live: true,
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
  emit({ saving: true, status: "Wrapping up audio…" });
  stopSpeech();
  await waitForStop();
  recorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  releaseAwake();
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  document.removeEventListener("visibilitychange", onVisibility);
  const durationSec = elapsed();
  startedAt = 0;
  const blob = new Blob(chunks, { type: mime || "audio/webm" });
  emit({ status: "Transcribing…" });
  const spoken = blob.size > 500 ? await transcribeBlob(blob) : "";
  const transcript = spoken || captions.trim();
  emit({ live: false, paused: false });
  if (!transcript) {
    emit({
      saving: false,
      draft: null,
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
  captions = "";
  chunks = [];
  emit({
    saving: false,
    draft: null,
    captions: "",
    seconds: 0,
    status: "Listening for your voice · keep this tab open.",
  });
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
  emit({
    live: false,
    draft: null,
    captions: "",
    seconds: 0,
    status: "Listening for your voice · keep this tab open.",
  });
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
  emit({ draft: null, captions: "", seconds: 0, status: "Listening for your voice · keep this tab open." });
  return result;
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
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  document.removeEventListener("visibilitychange", onVisibility);
  chunks = [];
  captions = "";
  startedAt = 0;
  pausedAccum = 0;
  pauseBegan = 0;
  emit({
    live: false,
    paused: false,
    saving: false,
    captions: "",
    seconds: 0,
    draft: null,
    hidden: false,
    status: "Listening for your voice · keep this tab open.",
  });
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
    return;
  }
  pauseBegan = Date.now();
  try {
    recorder?.pause();
  } catch {
    /* some browsers lack pause */
  }
  stopSpeech();
  emit({ paused: true, status: "Paused." });
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
