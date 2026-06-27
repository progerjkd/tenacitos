import { NextRequest, NextResponse } from "next/server";

// Run history is not yet exposed via the gateway API.
// The cron.list response includes lastRunAtMs and lastRunStatus on each job's state,
// which is sufficient for the UI. This endpoint returns empty for now.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Job ID required" }, { status: 400 });
  }

  return NextResponse.json({ runs: [], total: 0 });
}
