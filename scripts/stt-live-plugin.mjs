/**
 * Dev-server proxy: browser → /api/stt-live → wss://api.x.ai/v1/stt
 * Keeps the xAI key on the server. Vite HMR upgrades are left untouched.
 */
import { WebSocket, WebSocketServer } from "ws";

const UPSTREAM =
  "wss://api.x.ai/v1/stt?sample_rate=16000&encoding=pcm&interim_results=true&language=en";

export function sttLivePlugin() {
  return {
    name: "lectern:stt-live",
    apply: "serve",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (req, socket, head) => {
        const path = (req.url ?? "").split("?")[0];
        if (path !== "/api/stt-live") return;
        wss.handleUpgrade(req, socket, head, (client) => {
          const key = process.env.XAI_API_KEY;
          if (!key) {
            client.send(JSON.stringify({ type: "error", message: "Transcription is not available here." }));
            client.close();
            return;
          }
          const upstream = new WebSocket(UPSTREAM, {
            headers: { Authorization: `Bearer ${key}` },
          });
          const closeBoth = () => {
            try {
              client.close();
            } catch {
              /* ignore */
            }
            try {
              upstream.close();
            } catch {
              /* ignore */
            }
          };
          upstream.on("open", () => {
            client.on("message", (data, isBinary) => {
              if (upstream.readyState !== WebSocket.OPEN) return;
              if (isBinary) upstream.send(data);
              else upstream.send(String(data));
            });
          });
          upstream.on("message", (data, isBinary) => {
            if (client.readyState !== WebSocket.OPEN) return;
            if (isBinary) client.send(data);
            else client.send(String(data));
          });
          client.on("close", closeBoth);
          client.on("error", closeBoth);
          upstream.on("close", closeBoth);
          upstream.on("error", (err) => {
            try {
              client.send(JSON.stringify({ type: "error", message: err.message || "STT stream failed." }));
            } catch {
              /* ignore */
            }
            closeBoth();
          });
        });
      });
    },
  };
}
