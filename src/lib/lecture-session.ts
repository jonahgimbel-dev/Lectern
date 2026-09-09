import { saveLecture } from "@/functions/data";
import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, blobToWav, pickRecorderMime } from "@/lib/wav";

const SEGMENT_MS = 15_000;
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
let pending: Promise<void> = Promise.resolve();
let generation = 0;
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
  if (spoken && live && !spoken.includes(live) && live.split(/\s+/).length > 2) {
    return `${spoken} ${live}`.replace(/\s+/g, " ");
  }
  return spoken || live;
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
      try {
        recg.start();
      } catch {
        /* gesture may have expired — recorder still runs */
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

function stopSpeech() {
  try {
    speech?.stop();
  } catch {
    /* ignore */
  }
  speech = null;
}

function transcribeBlob(blob: Blob) {
  if (blob.size < 1200) return;
  const gen = generation;
  pending = pending.then(async () => {
    if (gen !== generation) return;
    try {
      const wav = await blobToWav(blob);
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
      /* live captions remain */
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
    transcribeBlob(new Blob(local, { type: rec.mimeType || mime || "audio/webm" }));
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
  }, SEGMENT_MS);
}

function attachMeter(nextStream: MediaStream, ctx: AudioContext) {
  try {
    const source = ctx.createMediaStreamSource(nextStream);
    const node = ctx.createAnalyser();
    node.fftSize = 256;
    source.connect(node);
    analyser = node;
    audioCtx = ctx;
    void ctx.resume();
  } catch {
    analyser = null;
  }
}

function readMeter() {
  if (!analyser) return { levels: snap.levels, hearing: snap.hearing };
  const bins = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(bins);
  let energy = 0;
  const levels = Array.from({ length: BAR_COUNT }, (_, i) => {
    const v = (bins[Math.floor((i / BAR_COUNT) * bins.length)] ?? 128) - 128;
    energy += v * v;
    return Math.min(1, Math.max(0.06, Math.abs(v) / 40));
  });
  return { levels, hearing: Math.sqrt(energy / bins.length) > 6 };
}

function tick() {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (!snap.live) return;
    const { levels, hearing } = readMeter();
    const now = Date.now();
    if (hearing || liveCaptions) quietSince = now;
    const stillHearing = hearing || liveCaptions.length > 0 || (quietSince > 0 && now - quietSince < 1800);
    emit({
      hidden: document.hidden,
      hearing: stillHearing,
      levels,
      status: snap.paused
        ? "Paused."
        : stillHearing
          ? document.hidden
            ? "Still recording in the background. Don’t close this tab."
            : "Listening for your voice · keep this tab open."
          : "Listening for your voice · keep this tab open.",
    });
  }, 200);
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

function hardStop() {
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
  void audioCtx?.close().catch(() => undefined);
  audioCtx = null;
  analyser = null;
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
  mime = pickRecorderMime();
  startedAt = Date.now();
  pausedAccum = 0;
  pauseBegan = 0;
  quietSince = Date.now();
  generation += 1;

  // Must run in the Rec click — speech + AudioContext need the user gesture.
  const ctx = typeof AudioContext !== "undefined" ? new AudioContext() : null;
  void ctx?.resume();
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
    status: "Allow the microphone…",
    seconds: 0,
  });
  startSpeech();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  tick();

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    hardStop();
    emit({ ...idleSnap(), status: micError(error) });
    throw new Error(micError(error));
  }

  if (ctx) attachMeter(stream, ctx);
  try {
    openRecorder();
    scheduleRotate();
  } catch {
    /* captions still run */
  }
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
  if (rotator) window.clearTimeout(rotator);
  rotator = null;
  stopSpeech();
  await waitForStop();
  recorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (ticker) window.clearInterval(ticker);
  ticker = null;
  void audioCtx?.close().catch(() => undefined);
  audioCtx = null;
  analyser = null;
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
