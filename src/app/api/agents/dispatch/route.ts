import { NextRequest, NextResponse } from "next/server";
import { callGateway, GatewayError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

interface DispatchBody {
  agentSlug: string;
  message: string;
  sessionSuffix?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<DispatchBody>;
  const { agentSlug, message, sessionSuffix = "main" } = body;

  if (!agentSlug || !message) {
    return NextResponse.json(
      { error: "agentSlug and message are required" },
      { status: 400 },
    );
  }

  if (!/^[a-z0-9_-]+$/.test(agentSlug)) {
    return NextResponse.json({ error: "Invalid agentSlug" }, { status: 400 });
  }

  const sessionKey = `agent:${agentSlug}:${sessionSuffix}`;

  try {
    await callGateway("sessions.send", {
      key: sessionKey,
      message,
      timeoutMs: 0,
    });
    return NextResponse.json({ ok: true, sessionKey });
  } catch (error) {
    const msg =
      error instanceof GatewayError ? error.message : "Dispatch failed";
    console.error("Dispatch error:", error);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
