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
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getProjectIssues,
  getSingleIssue,
  getTransitions,
  transitionIssue,
  addJiraComment,
  type JiraIssue,
} from "@/lib/jira";
import { sendSlackMessage } from "@/lib/slack";
import { callGateway } from "@/lib/gateway";
import { createNotification } from "@/lib/notifications";

const PROJECT = "NEURALOPS";
const DEFAULT_AGENT = "main";
const NOTIFY_CHANNEL = "#dev";

interface DispatchResult {
  key: string;
  summary: string;
  dispatched: boolean;
  transitioned: boolean;
  slackNotified: boolean;
  error?: string;
}

async function dispatchToAgent(issue: JiraIssue, agentSlug: string): Promise<boolean> {
  const message = [
    `Work on ${issue.key}: ${issue.summary}`,
    ``,
    `Jira: ${issue.url}`,
    `Priority: ${issue.priority} | Type: ${issue.issuetype}`,
    ``,
    `Please implement the changes described in this ticket, then move the issue to Done when complete.`,
    ``,
    `While working:`,
    `- Post a short comment on this Jira issue after each meaningful step, not just at the end.`,
    `- If you're blocked or need a decision from a human to proceed, add a Jira comment starting`,
    `  with the literal text "NEEDS INPUT:" followed by exactly what you need — then pause and`,
    `  wait rather than guessing. That marker is monitored and will page a human.`,
  ].join("\n");

  const sessionKey = `agent:${agentSlug}:main`;
  await callGateway("sessions.send", { key: sessionKey, message, timeoutMs: 0 });
  return true;
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    issueKey?: string;
    agentSlug?: string;
    dryRun?: boolean;
  };

  const agentSlug = body.agentSlug ?? DEFAULT_AGENT;
  const dryRun = body.dryRun ?? false;

  let issues: JiraIssue[];
  try {
    if (body.issueKey) {
      const single = await getSingleIssue(body.issueKey);
      if (!single) {
        return NextResponse.json(
          { error: `Issue not found: ${body.issueKey}` },
          { status: 404 },
        );
      }
      issues = [single];
    } else {
      const all = await getProjectIssues(PROJECT);
      issues = all.filter((i) => i.status === "To Do");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch issues";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (issues.length === 0) {
    return NextResponse.json({ dispatched: [], message: "No To Do issues found" });
  }

  const results: DispatchResult[] = [];

  for (const issue of issues) {
    const result: DispatchResult = {
      key: issue.key,
      summary: issue.summary,
      dispatched: false,
      transitioned: false,
      slackNotified: false,
    };

    if (dryRun) {
      result.dispatched = true;
      result.transitioned = true;
      result.slackNotified = true;
      results.push(result);
      continue;
    }

    try {
      // 1. Dispatch to agent
      result.dispatched = await dispatchToAgent(issue, agentSlug);

      // 2. Transition to "In Progress" (only if not already)
      if (issue.status === "To Do") {
        const transitions = await getTransitions(issue.key);
        const inProgress = transitions.find(
          (t) =>
            t.name.toLowerCase().includes("progress") ||
            t.name.toLowerCase() === "in progress",
        );
        if (inProgress) {
          await transitionIssue(issue.key, inProgress.id);
          result.transitioned = true;
        }
      } else {
        result.transitioned = true;
      }

      // 3. Post comment on Jira issue
      await addJiraComment(
        issue.key,
        `🤖 OpenClaw agent dispatched to work on this issue.\nAgent: ${agentSlug} | Session: ${issue.key.toLowerCase()}\nAuto-dispatched via TenacitOS Mission Control.`,
      ).catch(() => null);

      // 4. Send Slack notification
      const slackText = `🤖 *${issue.key}* dispatched to agent \`${agentSlug}\`\n*${issue.summary}*\n<${issue.url}|View in Jira>`;
      const slackResult = await sendSlackMessage(NOTIFY_CHANNEL, slackText);
      result.slackNotified = slackResult.ok;

      // 5. Create TenacitOS notification
      await createNotification({
        title: `Agent dispatched: ${issue.key}`,
        message: issue.summary,
        type: "info",
        link: `/jira`,
        metadata: { issueKey: issue.key, issueUrl: issue.url },
      }).catch(() => null);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    results.push(result);
  }

  const summary = {
    total: results.length,
    dispatched: results.filter((r) => r.dispatched).length,
    errors: results.filter((r) => r.error).length,
    dryRun,
  };

  return NextResponse.json({ summary, dispatched: results });
}
