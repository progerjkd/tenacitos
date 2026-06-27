import { NextResponse } from "next/server";
import { callGateway, GatewayError, type CronListResult, type CronJob } from "@/lib/gateway";

export const dynamic = "force-dynamic";

function formatScheduleDisplay(schedule: CronJob["schedule"]): string {
  if (!schedule) return "Unknown";
  switch (schedule.kind) {
    case "cron":
      return `${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    case "every": {
      const ms = schedule.everyMs ?? 0;
      if (ms >= 3600000) return `Every ${ms / 3600000}h`;
      if (ms >= 60000) return `Every ${ms / 60000}m`;
      return `Every ${ms / 1000}s`;
    }
    case "at":
      return `Once at ${schedule.at}`;
    default:
      return JSON.stringify(schedule);
  }
}

export async function GET() {
  try {
    const result = await callGateway<CronListResult>("cron.list", {});
    const jobs = (result.jobs ?? []).map((job) => ({
      id: job.id,
      agentId: job.agentId ?? "main",
      name: job.name ?? "Unnamed",
      enabled: job.enabled ?? true,
      schedule: job.schedule,
      state: job.state,
      payload: job.payload,
      scheduleDisplay: formatScheduleDisplay(job.schedule),
      timezone: job.schedule?.tz ?? "UTC",
      nextRun: job.state?.nextRunAtMs
        ? new Date(job.state.nextRunAtMs).toISOString()
        : null,
      lastRun: job.state?.lastRunAtMs
        ? new Date(job.state.lastRunAtMs).toISOString()
        : null,
    }));

    return NextResponse.json(jobs);
  } catch (error) {
    const msg =
      error instanceof GatewayError ? error.message : "Failed to fetch cron jobs";
    console.error("Error fetching cron jobs:", error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// PUT: enable/disable — not yet supported by gateway API
export async function PUT() {
  return NextResponse.json(
    { error: "Toggle not supported via gateway" },
    { status: 501 },
  );
}

// DELETE: not yet supported by gateway API
export async function DELETE() {
  return NextResponse.json(
    { error: "Delete not supported via gateway" },
    { status: 501 },
  );
}
