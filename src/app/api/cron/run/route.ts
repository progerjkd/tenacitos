import { NextRequest, NextResponse } from "next/server";
import { callGateway, GatewayError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body as { id?: string };

    if (!id) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    await callGateway("cron.run", { id, mode: "force" });

    return NextResponse.json({ success: true, jobId: id });
  } catch (error) {
    const msg =
      error instanceof GatewayError ? error.message : "Failed to trigger job";
    console.error("Error triggering cron job:", error);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
