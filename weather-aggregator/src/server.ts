import http from "node:http";
import { config } from "./config.js";
import { debug } from "./log.js";
import { subscribe } from "./subscription.js";

interface Notification {
  subscriptionId?: string;
  data?: Record<string, unknown>[];
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/notify") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    res.writeHead(200).end();
    try {
      const n = JSON.parse(Buffer.concat(chunks).toString()) as Notification;
      debug(
        `notification ${n.subscriptionId ?? ""} with ${n.data?.length ?? 0} entities`,
      );
      for (const e of n.data ?? []) debug("entity", e);
    } catch (err) {
      debug(`unparseable notification: ${(err as Error).message}`);
    }
    return;
  }
  res.writeHead(req.url === "/health" ? 200 : 404).end();
});

server.listen(config.port, () => {
  debug(`weather-aggregator listening on :${config.port}`);
  void subscribe();
});
