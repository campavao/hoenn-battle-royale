// /world: spike B's shared world (web/spike-b/shared/service.ts, bundled into
// world/service.js by tools/br/bundle-world.mjs). One Hoenn for every phone that
// opens /spike-b/, stepped here at 60 Hz and sent to each of them frame by frame.
//
// Nothing of it loads until the first phone asks: the maps are half a megabyte, and
// a relay that only runs matches never needs them.

import { WebSocketServer } from "ws";

export const WORLD_PATH = "/world";
// Bots wandering Hoenn, and trainers at most (Cam's cap: 30).
const BOTS = 64;
const CAP = 30;
// A household's phones share one address: a few of them, not a script's hundred.
const PER_IP = Number(process.env.BR_WORLD_PER_IP) || 8;
// Output a phone has not read yet: past this it is not keeping up (or not reading at
// all), and it goes before it can grow the relay that runs the matches too.
const SEND_BUFFER = 1 << 20;
// A socket that stops answering pings (a phone gone without a goodbye) goes.
const PING_MS = 15_000;

export function createWorld({ log = () => {}, now = () => performance.now() } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const perIp = new Map();
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.brAlive === false) { ws.terminate(); continue; }
      ws.brAlive = false;
      ws.ping();
    }
  }, PING_MS);
  pinger.unref();
  let service = null;
  let loading = null;
  const load = () => {
    loading ??= import("./world/service.js").then((m) => {
      service = new m.WorldService({ maps: m.MAPS, patches: m.PATCHES, bots: BOTS, cap: CAP, now, log });
      return service;
    });
    return loading;
  };

  return {
    get service() { return service; },
    handle(req, socket, head, ip) {
      const n = (perIp.get(ip) || 0) + 1;
      if (n > PER_IP) {
        log(`world: refused ${ip}: ${n} connections from one address`);
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        perIp.set(ip, n);
        let session = null;
        const early = [];
        let closed = false;
        const done = () => {
          if (closed) return;
          closed = true;
          const left = (perIp.get(ip) || 1) - 1;
          if (left <= 0) perIp.delete(ip); else perIp.set(ip, left);
          session?.onClose();
        };
        ws.on("message", (data, isBinary) => {
          if (isBinary) return;
          if (session) session.onText(String(data));
          else if (early.length < 8) early.push(String(data));
        });
        ws.on("close", done);
        ws.brAlive = true;
        ws.on("pong", () => { ws.brAlive = true; });
        let closing = false;
        const close = () => {
          if (closing) return;
          closing = true;
          ws.close(1000);
          setTimeout(() => ws.terminate(), 5000).unref();
        };
        ws.on("error", () => ws.terminate());
        load().then((s) => {
          if (closed) return;
          session = s.open({
            send: (text) => {
              if (ws.readyState !== 1) return;
              if (ws.bufferedAmount > SEND_BUFFER) {
                log(`world: dropped ${ip}: ${ws.bufferedAmount} bytes unread`);
                ws.terminate();
                return;
              }
              ws.send(text);
            },
            close,
          });
          for (const t of early.splice(0)) session.onText(t);
        }, (err) => {
          log(`world: not loaded: ${err && err.stack || err}`);
          ws.close(1011);
        });
      });
    },
    close() {
      clearInterval(pinger);
      service?.stop();
      for (const ws of wss.clients) ws.terminate();
    },
  };
}
