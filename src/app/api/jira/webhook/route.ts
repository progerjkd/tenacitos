/**
 * POST /api/jira/webhook
 * Receives Jira webhook events and triggers auto-dispatch for issues that
 * land in "To Do" status. Also relays "NEEDS INPUT:" comments (posted by the
 * dispatched agent when it's blocked) straight to Slack + the notification
 * bell.
 *
 * Provisioned as a single native Jira webhook (Jira Settings → System →
 * WebHooks, id 1 on neuralops.atlassian.net as of 2026-07-13 — registered via
 * POST /rest/webhooks/1.0/webhook, not a manual Automation rule):
 *   events: jira:issue_created, jira:issue_updated, comment_created
 *   jqlFilter: project = NEURALOPS
 *   url: https://mc.neuralops.ca/api/jira/webhook
 *
 * Native webhooks can't send custom headers, so if JIRA_WEBHOOK_SECRET is
 * set, this route also accepts it as a `?secret=` query param — append
 * `?secret=<value>` to the native webhook's URL when setting the env var.
 * Until then the only protection is the security group rule
 * (openclaw-terraform/main.tf) restricting inbound 443 to Atlassian's
 * published Jira egress CIDRs.
 *
 * Supported events: issue_created, issue_updated, plus any request carrying
 * a `comment.body` field (comment-added relay, event name not checked).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSingleIssue } from "@/lib/jira";
import { runAutoDispatch } from "@/lib/jira-dispatch";
import { sendSlackMessage } from "@/lib/slack";
import { createNotification } from "@/lib/notifications";

const NOTIFY_CHANNEL = "#dev";
const NEEDS_INPUT_MARKER = /^needs input:/i;

// Jira Cloud webhook payloads normally send comment.body as a plain string,
// but issue comment bodies can also arrive in Atlassian Document Format
// (nested content[].content[].text) — handle both defensively.
function extractPlainText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (typeof obj.text === "string") texts.push(obj.text);
        if (obj.content) walk(obj.content);
      }
    };
    walk(body);
    return texts.join(" ");
  }
  return "";
}

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
    body?: unknown;
    author?: { displayName?: string };
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
  // Fail closed: this route is exempt from the mc_auth cookie gate (see
  // proxy.ts), so JIRA_WEBHOOK_SECRET is the only thing standing between it
  // and an unauthenticated POST that can trigger runAutoDispatch.
  if (!secret) return false;
  const header = request.headers.get("x-jira-webhook-secret");
  if (header === secret) return true;
  // Native Jira webhooks can't set custom headers, so also accept the
  // secret as a query param for that delivery path.
  return request.nextUrl.searchParams.get("secret") === secret;
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

  // Comment-added relay: an agent stuck mid-task posts a Jira comment starting
  // with "NEEDS INPUT:" — forward it to Slack + the in-app notification bell
  // immediately, instead of it sitting silently on the ticket.
  const commentBody = extractPlainText(payload.comment?.body).trim();
  if (commentBody && NEEDS_INPUT_MARKER.test(commentBody)) {
    const issueUrl = `${(process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "")}/browse/${issueKey}`;
    const author = payload.comment?.author?.displayName ?? "agent";

    await sendSlackMessage(
      NOTIFY_CHANNEL,
      `❓ *${issueKey}* needs your input (from ${author}):\n>${commentBody}\n<${issueUrl}|Reply in Jira>`,
    ).catch(() => null);

    await createNotification({
      title: `${issueKey} needs input`,
      message: commentBody.slice(0, 200),
      type: "warning",
      link: `/jira`,
      metadata: { issueKey, issueUrl },
    }).catch(() => null);

    return NextResponse.json({ ok: true, issueKey, event: "needs_input_relayed" });
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

  // Trigger auto-dispatch for this issue. Called in-process rather than via
  // an internal HTTP fetch to /api/jira/auto-dispatch: a same-origin fetch
  // would re-enter proxy.ts, which has no mc_auth cookie to check for a
  // server-to-server call and would reject it with 401.
  try {
    const result = await runAutoDispatch({ issueKey });
    return NextResponse.json({
      ok: true,
      issueKey,
      event,
      dispatch: result.summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-dispatch failed";
    await sendSlackMessage(
      NOTIFY_CHANNEL,
      `⚠️ Jira webhook received for *${issueKey}* but auto-dispatch failed: ${msg}`,
    ).catch(() => null);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
