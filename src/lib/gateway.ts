import WebSocket from "ws";

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

type RequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: string };
};

type GatewayFrame = RequestFrame | ResponseFrame | { type: "event"; [k: string]: unknown };

const GATEWAY_TIMEOUT_MS = 30_000;

function gatewayWsUrl(): string {
  const base = process.env.OPENCLAW_GATEWAY_URL ?? "http://localhost:18789";
  return base.replace(/^http/, "ws");
}

export async function callGateway<T>(method: string, params?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

    const ws = new WebSocket(gatewayWsUrl(), {
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
      },
    });

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new GatewayError("timeout", `Gateway request timed out: ${method}`));
    }, GATEWAY_TIMEOUT_MS);

    const pending = new Map<string, (frame: ResponseFrame) => void>();

    function send(frame: RequestFrame) {
      ws.send(JSON.stringify(frame));
    }

    function newId() {
      return Math.random().toString(36).slice(2);
    }

    function doCall() {
      const id = newId();
      pending.set(id, (res) => {
        clearTimeout(timer);
        ws.close();
        if (res.ok) {
          resolve(res.payload as T);
        } else {
          reject(
            new GatewayError(
              res.error?.code ?? "gateway_error",
              res.error?.message ?? "Gateway error",
            ),
          );
        }
      });
      send({ type: "req", id, method, params });
    }

    const connectId = newId();
    let connected = false;

    ws.on("open", () => {
      send({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 4,
          maxProtocol: 4,
          client: {
            id: "tenacitos",
            displayName: "NeuralOps Mission Control",
            version: "1.0.0",
            platform: "server",
            mode: "backend",
          },
          role: "operator",
          scopes: ["operator.read", "operator.write", "operator.admin"],
          auth: { token: gatewayToken },
        },
      });
    });

    ws.on("message", (raw) => {
      let frame: GatewayFrame;
      try {
        frame = JSON.parse(raw.toString()) as GatewayFrame;
      } catch {
        return;
      }

      if (frame.type === "res") {
        const res = frame as ResponseFrame;
        if (res.id === connectId) {
          if (!res.ok) {
            clearTimeout(timer);
            ws.close();
            reject(
              new GatewayError("connect_failed", res.error?.message ?? "Gateway connect failed"),
            );
            return;
          }
          connected = true;
          doCall();
          return;
        }
        const handler = pending.get(res.id);
        if (handler) {
          pending.delete(res.id);
          handler(res);
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(new GatewayError("ws_error", err.message));
    });

    ws.on("close", () => {
      if (!connected) {
        clearTimeout(timer);
        reject(new GatewayError("ws_closed", "Gateway WebSocket closed before connect"));
      }
    });
  });
}

export async function checkGatewayHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(
      `${process.env.OPENCLAW_GATEWAY_URL ?? "http://localhost:18789"}/health`,
      {
        headers: { Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN ?? ""}` },
        cache: "no-store",
      },
    );
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  runningAtMs?: number;
}

export interface CronSchedule {
  kind: "cron" | "every" | "at";
  expr?: string;
  tz?: string;
  everyMs?: number;
  at?: string;
}

export interface CronJob {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  schedule: CronSchedule;
  state: CronJobState;
  payload?: Record<string, unknown>;
  sessionTarget?: string;
}

export interface CronListResult {
  jobs: CronJob[];
  total?: number;
}
