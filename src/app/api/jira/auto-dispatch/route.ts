/**
 * POST /api/jira/auto-dispatch
 * Fetches all "To Do" issues (or a specific key), dispatches each to the main
 * OpenClaw agent, transitions them to "In Progress", posts a Jira comment, and
 * sends a Slack notification to #dev + a TenacitOS notification.
 *
 * Body (all optional):
 *   { issueKey?: string, agentSlug?: string, dryRun?: boolean }
 *
 * If issueKey is provided, only that issue is dispatched.
 * If dryRun is true, nothing is mutated — only the plan is returned.
 *
 * Cookie-gated (see proxy.ts) — this is the manual/dashboard trigger path.
 * The Jira webhook (/api/jira/webhook) calls runAutoDispatch() directly
 * in-process instead of hitting this route, since it has no mc_auth cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { runAutoDispatch, IssueNotFoundError } from "@/lib/jira-dispatch";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    issueKey?: string;
    agentSlug?: string;
    dryRun?: boolean;
  };

  try {
    const result = await runAutoDispatch(body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IssueNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : "Failed to fetch issues";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
