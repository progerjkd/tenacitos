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
import { extractPlainText } from "@/lib/adf";

const NOTIFY_CHANNEL = "#dev";
const NEEDS_INPUT_MARKER = /^needs input:/i;

// Jira can redeliver the same webhook (retry after a slow response, etc.), and this route has no
// per-event ID to key off of — so without this, a redelivered "moved to Done" event posts the
// resolution notice twice. Checked and set synchronously (no await between them), so unlike the
// dispatch path this needs no lock: there's no gap for a second concurrent request to interleave.
// The window alone would also swallow a legitimate reopen-then-reclose within it, so that case is
// handled separately below by clearing the mark as soon as the issue leaves Done.
const RESOLVED_DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const resolvedNotifyMarks = new Map<string, number>();

function wasResolvedNotifiedRecently(key: string): boolean {
  const ts = resolvedNotifyMarks.get(key);
  return ts !== undefined && Date.now() - ts < RESOLVED_DEDUPE_WINDOW_MS;
}

function markResolvedNotified(key: string): void {
  const now = Date.now();
  for (const [k, ts] of resolvedNotifyMarks) {
    if (now - ts >= RESOLVED_DEDUPE_WINDOW_MS) resolvedNotifyMarks.delete(k);
  }
  resolvedNotifyMarks.set(key, now);
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

  // Clear any resolved-notification mark once the issue leaves Done, so a legitimate reopen +
  // re-close within the dedupe window isn't mistaken for a redelivery of the earlier resolution.
  const movedAwayFromDone = payload.changelog?.items?.some(
    (item) =>
      item.field === "status" &&
      item.fromString?.toLowerCase() === "done" &&
      item.toString?.toLowerCase() !== "done",
  );
  if (movedAwayFromDone) {
    resolvedNotifyMarks.delete(issueKey);
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

  // Resolution relay: a ticket landing in "Done" doesn't otherwise produce any signal — the
  // dispatched agent is only asked to ping Slack/Roger itself, which it won't reliably do for
  // trivial tickets it closes without real work. Post the completion notice here instead of
  // depending on that.
  const isMovedToDone =
    event === "jira:issue_updated" &&
    payload.changelog?.items?.some(
      (item) => item.field === "status" && item.toString?.toLowerCase() === "done",
    );

  if (isMovedToDone) {
    // A delayed or redelivered webhook can arrive after the issue has already been reopened —
    // the changelog in the payload only proves it moved to Done at some point, not that it's
    // still there now. Re-fetch and confirm, the same way the dispatch path below does.
    const doneIssue = await getSingleIssue(issueKey).catch(() => null);
    if (!doneIssue || doneIssue.status !== "Done") {
      return NextResponse.json({ skipped: true, reason: "status is not Done anymore" });
    }

    if (wasResolvedNotifiedRecently(issueKey)) {
      return NextResponse.json({ skipped: true, reason: "resolution already notified" });
    }
    markResolvedNotified(issueKey);

    const summary = doneIssue.summary;
    const issueUrl = `${(process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "")}/browse/${issueKey}`;

    await sendSlackMessage(
      NOTIFY_CHANNEL,
      `✅ *${issueKey}* resolved\n*${summary}*\n<${issueUrl}|View in Jira>`,
    ).catch(() => null);

    await createNotification({
      title: `${issueKey} resolved`,
      message: summary,
      type: "success",
      link: `/jira`,
      metadata: { issueKey, issueUrl },
    }).catch(() => null);

    return NextResponse.json({ ok: true, issueKey, event: "resolved_notified" });
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
