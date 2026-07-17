/**
 * Shared auto-dispatch logic for Jira "To Do" issues.
 *
 * Used directly (in-process) by both:
 *   - POST /api/jira/auto-dispatch (manual/dashboard trigger, cookie-gated)
 *   - POST /api/jira/webhook (Atlassian webhook, gated by JIRA_WEBHOOK_SECRET)
 *
 * The webhook route calls this function directly rather than issuing an
 * internal HTTP fetch to /api/jira/auto-dispatch — a same-origin fetch would
 * re-enter the Next.js auth middleware (proxy.ts), which has no cookie to
 * check for a server-to-server call and would reject it with 401.
 */
import {
  getProjectIssues,
  getSingleIssue,
  getTransitions,
  transitionIssue,
  assignIssue,
  addJiraComment,
  type JiraIssue,
} from "@/lib/jira";
import { sessionKeyForTicket } from "@/lib/jira-agent-session";
import { sendSlackMessage } from "@/lib/slack";
import { callGateway } from "@/lib/gateway";
import { createNotification } from "@/lib/notifications";

const PROJECT = "NEURALOPS";
export const DEFAULT_AGENT = "sage";
const NOTIFY_CHANNEL = "#dev";

// Each openclaw agent has its own Jira service account (see docs/jira-agent-accounts.md),
// so tickets show the actual agent working them as the assignee. Account IDs live in env
// vars rather than agents-config.ts since they're Jira-specific and only this module needs
// them.
const AGENT_JIRA_ACCOUNT_ENV: Record<string, string> = {
  sage: "JIRA_ACCOUNT_ID_SAGE",
  main: "JIRA_ACCOUNT_ID_MAIN",
  inbox: "JIRA_ACCOUNT_ID_INBOX",
  brief: "JIRA_ACCOUNT_ID_BRIEF",
  ghostwriter: "JIRA_ACCOUNT_ID_GHOSTWRITER",
  qa: "JIRA_ACCOUNT_ID_QA",
  playsmith: "JIRA_ACCOUNT_ID_PLAYSMITH",
};

function jiraAccountIdForAgent(agentSlug: string): string | undefined {
  const envVar = AGENT_JIRA_ACCOUNT_ENV[agentSlug];
  return envVar ? process.env[envVar] : undefined;
}

export class IssueNotFoundError extends Error {
  constructor(issueKey: string) {
    super(`Issue not found: ${issueKey}`);
    this.name = "IssueNotFoundError";
  }
}

export interface DispatchResult {
  key: string;
  summary: string;
  dispatched: boolean;
  transitioned: boolean;
  assigned: boolean;
  slackNotified: boolean;
  error?: string;
}

export interface AutoDispatchOptions {
  issueKey?: string;
  agentSlug?: string;
  dryRun?: boolean;
}

export interface AutoDispatchOutcome {
  summary: { total: number; dispatched: number; errors: number; dryRun: boolean };
  dispatched: DispatchResult[];
  message?: string;
}

async function dispatchToAgent(issue: JiraIssue, agentSlug: string): Promise<boolean> {
  const message = [
    `New ticket ready for triage: ${issue.key} — ${issue.summary}`,
    ``,
    `Jira: ${issue.url}`,
    `Priority: ${issue.priority} | Type: ${issue.issuetype}`,
    ``,
    `It's already been moved to In Progress and a #dev notification has gone out.`,
    `Read the ticket, write a scoped brief, and assign it to the right specialist per your`,
    `usual workflow. Track it through to done — checkpoints, review, and pinging Roger are`,
    `on you from here.`,
  ].join("\n");

  // One session per ticket, not a single shared session — each ticket is a
  // fully independent conversation, so a blocked ticket can't hold up
  // dispatch/work on any other ticket, and a later reply on this issue (see
  // the webhook route's comment relay) routes unambiguously back to the same
  // session. See docs/superpowers/specs/2026-07-16-jira-dispatch-per-ticket-sessions-design.md.
  const sessionKey = sessionKeyForTicket(agentSlug, issue.key);
  await callGateway("sessions.send", { key: sessionKey, message, timeoutMs: 0 });
  return true;
}

export async function runAutoDispatch(
  options: AutoDispatchOptions = {},
): Promise<AutoDispatchOutcome> {
  const agentSlug = options.agentSlug ?? DEFAULT_AGENT;
  const dryRun = options.dryRun ?? false;

  let issues: JiraIssue[];
  if (options.issueKey) {
    const single = await getSingleIssue(options.issueKey);
    if (!single) throw new IssueNotFoundError(options.issueKey);
    issues = [single];
  } else {
    const all = await getProjectIssues(PROJECT);
    issues = all.filter((i) => i.status === "To Do");
  }

  if (issues.length === 0) {
    return {
      summary: { total: 0, dispatched: 0, errors: 0, dryRun },
      dispatched: [],
      message: "No To Do issues found",
    };
  }

  const results: DispatchResult[] = [];

  for (const issue of issues) {
    const result: DispatchResult = {
      key: issue.key,
      summary: issue.summary,
      dispatched: false,
      transitioned: false,
      assigned: false,
      slackNotified: false,
    };

    if (dryRun) {
      result.dispatched = true;
      result.transitioned = true;
      result.assigned = true;
      result.slackNotified = true;
      results.push(result);
      continue;
    }

    try {
      // 1. Transition to "In Progress" (only if not already) — must happen
      // before dispatch, since the dispatch message tells Sage this is
      // already done.
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

      // 2. Assign to the agent's own Jira service account, if one is
      // configured. Best-effort — a missing/deactivated account shouldn't
      // block the rest of the dispatch.
      const accountId = jiraAccountIdForAgent(agentSlug);
      if (accountId) {
        result.assigned = await assignIssue(issue.key, accountId)
          .then(() => true)
          .catch(() => false);
      }

      // 3. Send Slack notification — also happens before dispatch, for the
      // same reason: the dispatch message claims it's already gone out.
      const slackText = `🤖 *${issue.key}* sent to \`${agentSlug}\` for triage\n*${issue.summary}*\n<${issue.url}|View in Jira>`;
      const slackResult = await sendSlackMessage(NOTIFY_CHANNEL, slackText);
      result.slackNotified = slackResult.ok;

      // 4. Dispatch to agent — only now, once the state it references is
      // actually true.
      result.dispatched = await dispatchToAgent(issue, agentSlug);

      // 5. Post comment on Jira issue
      await addJiraComment(
        issue.key,
        `🤖 Sent to ${agentSlug} for triage and assignment.\nAuto-dispatched via TenacitOS Mission Control.`,
      ).catch(() => null);

      // 6. Create TenacitOS notification
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

  return { summary, dispatched: results };
}
