/**
 * POST /api/jira/webhook
 * Receives Jira automation webhook events and triggers auto-dispatch for
 * issues that land in "To Do" status, or relays human replies to agent sessions.
 *
 * Configure in Jira: Project Settings → Automation → Webhook
 * URL: https://<your-domain>/api/jira/webhook
 * Header: X-Jira-Webhook-Secret: <JIRA_WEBHOOK_SECRET env var>
 *
 * Supported events: issue_created, issue_updated, comment_created
 */
import { NextRequest, NextResponse } from "next/server";
import { getSingleIssue } from "@/lib/jira";
import { sendSlackMessage } from "@/lib/slack";
import { callGateway } from "@/lib/gateway";

const NOTIFY_CHANNEL = "#dev";
const DEFAULT_AGENT = "main";

interface JiraWebhookPayload {
  webhookEvent?: string;
  issue?: {
    key: string;
    fields?: {
      summary?: string;
      status?: { name: string };
      priority?: { name: string };
      issuetype?: { name: string };
    };
  };
  comment?: {
    author?: {
      displayName?: string;
    };
    body?: string;
  };
  changelog?: {
    items?: Array<{
      field: string;
      fromString?: string;
      toString?: string;
    }>;
  };
}

function validateSecret(request: NextRequest): boolean {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured → open (dev mode)
  const header = request.headers.get("x-jira-webhook-secret");
  return header === secret;
}

function sessionKeyForTicket(agentSlug: string, issueKey: string): string {
  return `agent:${agentSlug}:${issueKey.toLowerCase()}`;
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: JiraWebhookPayload;
  try {
    payload = (await request.json()) as JiraWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = payload.webhookEvent;
  const issueKey = payload.issue?.key;

  if (!issueKey) {
    return NextResponse.json({ skipped: true, reason: "no issue key" });
  }

  // Handle comment relay: forward human replies to the agent session
  if (event === "comment_created") {
    const authorName = payload.comment?.author?.displayName ?? "Unknown";
    const commentBody = payload.comment?.body ?? "";

    if (!commentBody) {
      return NextResponse.json({ skipped: true, reason: "comment has no body" });
    }

    const relayMessage = [
      `💬 Reply from *${authorName}* on ${issueKey}:`,
      ``,
      commentBody,
    ].join("\n");

    const sessionKey = sessionKeyForTicket(DEFAULT_AGENT, issueKey);

    try {
      await callGateway("agent", {
        key: sessionKey,
        message: relayMessage,
        deliver: false,
      });
      return NextResponse.json({
        ok: true,
        issueKey,
        event,
        relayed: true,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Comment relay failed";
      console.error(`Comment relay failed for ${issueKey}:`, err);
      // Log the error but don't fail the webhook — it's not critical for the Jira event flow
      return NextResponse.json({
        ok: false,
        issueKey,
        event,
        error: errorMsg,
        note: "Comment relay failed but webhook request was valid",
      }, { status: 502 });
    }
  }

  // Only act on issue_created or status transitions into "To Do"
  const isCreated = event === "jira:issue_created";
  const isMovedToToDo =
    event === "jira:issue_updated" &&
    payload.changelog?.items?.some(
      (item) =>
        item.field === "status" &&
        item.toString?.toLowerCase() === "to do",
    );

  if (!isCreated && !isMovedToToDo) {
    return NextResponse.json({ skipped: true, reason: `event not actionable: ${event}` });
  }

  // Fetch the full issue to confirm current status
  const issue = await getSingleIssue(issueKey).catch(() => null);
  if (!issue) {
    return NextResponse.json({ skipped: true, reason: "issue fetch failed" });
  }

  if (issue.status !== "To Do") {
    return NextResponse.json({ skipped: true, reason: `status is "${issue.status}", not "To Do"` });
  }

  // Trigger auto-dispatch for this issue
  const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const dispatchRes = await fetch(`${baseUrl}/api/jira/auto-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueKey }),
  });

  const dispatchData = (await dispatchRes.json()) as {
    summary?: { dispatched: number; errors: number };
    error?: string;
  };

  if (!dispatchRes.ok || dispatchData.error) {
    // Notify Slack about the failure
    await sendSlackMessage(
      NOTIFY_CHANNEL,
      `⚠️ Jira webhook received for *${issueKey}* but auto-dispatch failed: ${dispatchData.error ?? "unknown error"}`,
    ).catch(() => null);
    return NextResponse.json({ ok: false, error: dispatchData.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    issueKey,
    event,
    dispatch: dispatchData.summary,
  });
}
