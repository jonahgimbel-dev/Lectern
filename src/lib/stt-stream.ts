import { transcribeAudio } from "@/functions/transcribe";
import { blobToBase64, pcmToWav } from "@/lib/wav";

const TARGET_RATE = 16_000;
const HTTP_FLUSH_SEC = 1.5;
const HTTP_SAMPLES = Math.floor(TARGET_RATE * HTTP_FLUSH_SEC);

export type SttHandlers = {
  onPartial: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
};

export type SttLive = {
  sendPcm: (samples: Int16Array) => void;
  close: () => Promise<string>;
};

export function openSttLive(handlers: SttHandlers): SttLive {
  let ws: WebSocket | null = null;
  let wsReady = false;
  let closed = false;
  let httpBuf = new Int16Array(HTTP_SAMPLES * 2);
  let httpLen = 0;
  let httpBusy = Promise.resolve();
  const finals: string[] = [];

  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
  try {
    ws = new WebSocket(`${proto}://${location.host}/api/stt-live`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg: { type?: string; text?: string; is_final?: boolean; speech_final?: boolean; message?: string } = {};
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "transcript.created") {
        wsReady = true;
        return;
      }
      if (msg.type === "transcript.partial" && msg.text) {
        if (msg.is_final || msg.speech_final) finals.push(msg.text.trim());
        handlers.onPartial(msg.text.trim(), Boolean(msg.is_final || msg.speech_final));
        return;
      }
      if (msg.type === "transcript.done" && msg.text) {
        finals.push(msg.text.trim());
        handlers.onPartial(msg.text.trim(), true);
        return;
      }
      if (msg.type === "error" && msg.message) handlers.onError(msg.message);
    };
    ws.onerror = () => {
      wsReady = false;
    };
    ws.onclose = () => {
      wsReady = false;
      ws = null;
    };
  } catch {
    ws = null;
  }

  function flushHttp(all = false) {
    const min = all ? TARGET_RATE * 0.4 : HTTP_SAMPLES;
    if (httpLen < min) return;
    const count = all ? httpLen : HTTP_SAMPLES;
    const slice = httpBuf.slice(0, count);
    const rest = httpBuf.slice(count, httpLen);
    httpBuf = new Int16Array(Math.max(HTTP_SAMPLES * 2, rest.length + HTTP_SAMPLES));
    httpBuf.set(rest);
    httpLen = rest.length;
    httpBusy = httpBusy.then(async () => {
      if (closed && !all) return;
      try {
        const spoken = await transcribeAudio({
          data: {
            base64: await blobToBase64(pcmToWav(slice, TARGET_RATE)),
            mimeType: "audio/wav",
            filename: "lecture.wav",
          },
        });
        if (spoken.ok && spoken.text) {
          finals.push(spoken.text.trim());
          handlers.onPartial(spoken.text.trim(), true);
        }
        // Empty clips stay quiet — a live lecture has pauses.
      } catch (error) {
        handlers.onError(error instanceof Error ? error.message : "Could not transcribe.");
      }
    });
  }

  return {
    sendPcm(samples) {
      if (closed || samples.length === 0) return;
      if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
        ws.send(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength));
        return;
      }
      if (httpLen + samples.length > httpBuf.length) {
        const grown = new Int16Array((httpLen + samples.length) * 2);
        grown.set(httpBuf.subarray(0, httpLen));
        httpBuf = grown;
      }
      httpBuf.set(samples, httpLen);
      httpLen += samples.length;
      if (httpLen >= HTTP_SAMPLES) flushHttp(false);
    },
    async close() {
      closed = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "audio.done" }));
        } catch {
          /* ignore */
        }
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 2500);
          ws?.addEventListener("close", () => {
            window.clearTimeout(timer);
            resolve();
          });
          try {
            ws?.close();
          } catch {
            resolve();
          }
        });
      }
      ws = null;
      wsReady = false;
      flushHttp(true);
      await httpBusy;
      return finals.join(" ").replace(/\s+/g, " ").trim();
    },
  };
}

export { TARGET_RATE };
