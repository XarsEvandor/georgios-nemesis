/**
 * The Nemesis companion: a small HTTP server on the GM's PC that holds the records and answers
 * the Foundry module. It needs no other module.
 *
 * Safety, as in Georgios' launcher: it listens on 127.0.0.1 only, accepts only this PC's own host
 * names (no DNS rebinding), and accepts browser requests only from the origins in
 * data/config.json (the GM's Foundry tab). Local programs send no Origin.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { NemesisService } from "./service";

export const VERSION = "0.1.0";
export const DEFAULT_PORT = 47120;
export const DEFAULT_ORIGINS = ["http://localhost:30000", "http://127.0.0.1:30000"];
const MAX_BODY = 2 * 1024 * 1024;

export interface NemesisServerOptions {
  dataDir: string;
  port?: number;
  origins?: string[];
  log?: (msg: string) => void;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, "request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        ok(text ? JSON.parse(text) : {});
      } catch {
        fail(new HttpError(400, "bad JSON"));
      }
    });
    req.on("error", fail);
  });
}

export class NemesisServer {
  readonly service: NemesisService;
  private http?: Server;
  private readonly origins: Set<string>;

  constructor(private readonly o: NemesisServerOptions) {
    this.service = new NemesisService(o.dataDir);
    this.origins = new Set(o.origins ?? DEFAULT_ORIGINS);
  }

  get port(): number {
    const a = this.http?.address();
    return typeof a === "object" && a ? a.port : (this.o.port ?? DEFAULT_PORT);
  }

  private async call(method: string, params: Record<string, any>): Promise<unknown> {
    if (method === "ping") return { ok: true, name: "georgios-nemesis", version: VERSION };
    if (method.startsWith("nemesis.")) return this.service.call(method, params);
    throw new Error(`unknown method ${method}`);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let id: unknown;
    try {
      const hosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`]);
      if (!hosts.has(req.headers.host ?? "")) throw new HttpError(403, "wrong host");
      const origin = req.headers.origin;
      if (origin) {
        if (!this.origins.has(origin)) throw new HttpError(403, `origin ${origin} is not in georgios-nemesis/data/config.json`);
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "content-type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        // Chrome asks this before a page may reach a local address.
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      if (req.method === "OPTIONS") return void res.writeHead(204).end();
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "GET" && (path === "/" || path === "/health")) return send(200, { ok: true, name: "georgios-nemesis", version: VERSION });
      if (req.method !== "POST" || path !== "/rpc") throw new HttpError(404, "not found");
      const body = await readJson(req);
      id = body.id;
      if (typeof body.method !== "string") throw new HttpError(400, "method required");
      const params = typeof body.params === "object" && body.params !== null ? (body.params as Record<string, any>) : {};
      send(200, { id, result: await this.call(body.method, params) });
    } catch (e) {
      send(e instanceof HttpError ? e.status : 400, { id, error: { message: (e as Error).message } });
    }
  }

  async start(): Promise<void> {
    this.http = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(this.o.port ?? DEFAULT_PORT, "127.0.0.1", () => resolve());
    });
    this.o.log?.(`Georgios' Nemesis companion ${VERSION} on http://127.0.0.1:${this.port}`);
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
  }
}
