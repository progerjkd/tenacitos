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
  getIssueComments,
  getCurrentToDoStintStart,
  type JiraIssue,
} from "@/lib/jira";
import { buildAgentDispatchParams } from "@/lib/jira-agent-session";
import { sendSlackMessage, resolveChannelId } from "@/lib/slack";
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

// Parallel to AGENT_JIRA_ACCOUNT_ENV above, but for the API token needed to post a comment AS
// that agent's own account, rather than just assigning tickets to it.
const AGENT_JIRA_TOKEN_ENV: Record<string, string> = {
  sage: "JIRA_API_TOKEN_SAGE",
  main: "JIRA_API_TOKEN_MAIN",
  inbox: "JIRA_API_TOKEN_INBOX",
  brief: "JIRA_API_TOKEN_BRIEF",
  ghostwriter: "JIRA_API_TOKEN_GHOSTWRITER",
  qa: "JIRA_API_TOKEN_QA",
  playsmith: "JIRA_API_TOKEN_PLAYSMITH",
};

// Real Atlassian account emails — named after each agent's display name (see
// agents-config.ts's AGENT_DEFS), NOT its internal slug. sage has no agents-config.ts
// entry (gateway-level coordinator, not a dashboard agent) but its slug and display
// name are both "sage". Confirmed against the actual Atlassian admin user list —
// do not derive this from the slug, "sage" is the only agent where slug == name.
const AGENT_JIRA_EMAIL: Record<string, string> = {
  sage: "sage@neuralops.ca",
  main: "max@neuralops.ca",
  inbox: "iris@neuralops.ca",
  brief: "quinn@neuralops.ca",
  ghostwriter: "echo@neuralops.ca",
  qa: "vale@neuralops.ca",
  playsmith: "pixel@neuralops.ca",
};

// Returns undefined (falls back to Roger's global credentials in addJiraComment) when the
// agent's own token env var isn't set yet — same graceful-degradation shape as
// jiraAccountIdForAgent above, deliberately: most agents won't have a token configured for a
// while, and nothing here should behave differently than today until one is.
function jiraCommentCredentialsForAgent(
  agentSlug: string,
): { email: string; token: string } | undefined {
  const envVar = AGENT_JIRA_TOKEN_ENV[agentSlug];
  const token = envVar ? process.env[envVar] : undefined;
  if (!token) return undefined;
  const email = AGENT_JIRA_EMAIL[agentSlug];
  if (!email) return undefined;
  return { email, token };
}

// Reverse of jiraAccountIdForAgent: given a Jira accountId (e.g. an issue's
// current assignee), find which agent slug it belongs to. Used by the
// webhook's comment relay to route a reply to whichever agent a ticket was
// actually dispatched to, instead of always assuming DEFAULT_AGENT.
export function agentSlugForJiraAccountId(accountId: string): string | undefined {
  for (const [slug, envVar] of Object.entries(AGENT_JIRA_ACCOUNT_ENV)) {
    if (process.env[envVar] === accountId) return slug;
  }
  return undefined;
}

// Marker left on the Jira comment posted by step 4 below. Jira can deliver more than one
// qualifying webhook event for the same status change (e.g. issue_created firing alongside a
// near-simultaneous issue_updated into "To Do"), and runAutoDispatch has no other memory across
// calls — so re-check this marker before doing anything, rather than dispatching blind every time
// an issue is seen in "To Do".
//
// A marker only counts as "already dispatched" if it carries the *same stint* tag as the one
// captured for the current check (see below) — not merely one whose timestamp happens to fall
// after the current stint's start. The stint can legitimately change *during* the Slack/gateway
// work between capturing it and writing the marker (the issue leaves and re-enters "To Do" while
// a dispatch for the old stint is still in flight); comparing by timestamp at write time would
// then misattribute that marker to the new stint and wrongly suppress its own dispatch. Comparing
// by the stint value captured before the work began avoids that regardless of how long it takes.
// DISPATCH_DEDUPE_WINDOW_MS is only the fallback when a stint can't be resolved on either side.
const DISPATCH_MARKER = "Auto-dispatched via TenacitOS Mission Control.";
const DISPATCH_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

function buildDispatchMarker(stintStart: number | null): string {
  return stintStart === null ? DISPATCH_MARKER : `${DISPATCH_MARKER} [stint:${stintStart}]`;
}

// Exported so the webhook's comment relay can check whether a ticket has ever actually been
// dispatched through this pipeline, rather than inferring it from current status — a status other
// than "To Do" doesn't prove dispatch happened (e.g. the dashboard's manual Start action moves an
// issue straight to "In Progress" without going through runAutoDispatch).
export function isDispatchMarker(body: string): boolean {
  return body.includes(DISPATCH_MARKER);
}

function extractMarkerStint(body: string): number | null {
  const match = body.match(/\[stint:(\d+)\]/);
  return match ? Number(match[1]) : null;
}

// Per-issue-key serialization so two overlapping runAutoDispatch calls (e.g. two concurrent
// webhook deliveries for the same issue) can't both read "not yet dispatched" before either has
// posted the marker comment — without this the comment check above is a TOCTOU race, not a real
// guard. Chaining onto the map entry keeps each key's calls strictly sequential; unrelated issue
// keys still run concurrently.
const dispatchLocks = new Map<string, Promise<unknown>>();

// Fallback dedupe source alongside the Jira comment marker: if posting that comment fails (rate
// limit, transient 5xx, permissions), the marker never lands, so a later queued call would find
// nothing and re-dispatch — recreating the exact duplicate this whole mechanism exists to prevent.
// This in-process record survives that specific failure since it's set right after the dispatch
// itself succeeds, independent of whether the Jira write does.
//
// Stores the stint captured at the *start* of the check (same reasoning as the Jira marker above)
// rather than the completion timestamp, so identity — not wall-clock ordering — is what's compared.
interface LocalDispatchMark {
  stintStart: number | null;
  capturedAt: number;
}
const localDispatchMarks = new Map<string, LocalDispatchMark>();

function markDispatchedLocally(key: string, stintStart: number | null): void {
  const now = Date.now();
  for (const [k, mark] of localDispatchMarks) {
    if (now - mark.capturedAt >= DISPATCH_DEDUPE_WINDOW_MS) localDispatchMarks.delete(k);
  }
  localDispatchMarks.set(key, { stintStart, capturedAt: now });
}

function wasDispatchedLocallyRecently(key: string, stintStart: number | null): boolean {
  const mark = localDispatchMarks.get(key);
  if (!mark) return false;
  if (stintStart !== null && mark.stintStart !== null) {
    return mark.stintStart === stintStart;
  }
  // Couldn't resolve a stint on one side or the other — fall back to a short window.
  return Date.now() - mark.capturedAt < DISPATCH_DEDUPE_WINDOW_MS;
}

function withDispatchLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = dispatchLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tracked = run.catch(() => {});
  dispatchLocks.set(key, tracked);
  // Only clear the entry if nothing has chained onto it since — otherwise this delete would drop
  // a newer call's place in the queue and let it run concurrently with a still-in-flight one.
  tracked.finally(() => {
    if (dispatchLocks.get(key) === tracked) {
      dispatchLocks.delete(key);
    }
  });
  return run;
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
  skipped?: boolean;
  error?: string;
}

export interface AutoDispatchOptions {
  issueKey?: string;
  agentSlug?: string;
  dryRun?: boolean;
}

export interface AutoDispatchOutcome {
  summary: { total: number; dispatched: number; errors: number; skipped: number; dryRun: boolean };
  dispatched: DispatchResult[];
  message?: string;
}

async function dispatchToAgent(
  issue: JiraIssue,
  agentSlug: string,
  stintStart: number | null,
): Promise<boolean> {
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

  // The gateway's "agent" RPC method resolves/creates the target session if it doesn't exist
  // yet — unlike "sessions.send", which requires the session to already exist and throws
  // INVALID_REQUEST otherwise. Per-ticket session keys (one independent conversation per
  // ticket, not a single shared session) are still built the same way, inside
  // buildAgentDispatchParams. See docs/superpowers/specs/2026-08-07-jira-dispatch-agent-rpc-fix-design.md.
  let channelId: string | null = null;
  try {
    channelId = await resolveChannelId(NOTIFY_CHANNEL);
    if (channelId === null) {
      console.warn(
        `Slack channel "${NOTIFY_CHANNEL}" not found; dispatching ${issue.key} without native delivery.`,
      );
    }
  } catch (err) {
    console.warn(`Slack channel resolution failed for ${issue.key}; dispatching without native delivery:`, err);
  }
  const params = buildAgentDispatchParams({
    agentSlug,
    issueKey: issue.key,
    message,
    stintStart,
    slackChannelId: channelId,
  });

  await callGateway("agent", params);
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
      summary: { total: 0, dispatched: 0, errors: 0, skipped: 0, dryRun },
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

    await withDispatchLock(issue.key, async () => {
      let stintStart: number | null = null;
      try {
        stintStart = await getCurrentToDoStintStart(issue.key);
      } catch {
        // Can't resolve the current stint — checks below fall back to a short window.
      }

      let alreadyDispatched = wasDispatchedLocallyRecently(issue.key, stintStart);
      if (!alreadyDispatched) {
        try {
          const comments = await getIssueComments(issue.key, { since: stintStart ?? undefined });
          alreadyDispatched = comments.some((c) => {
            if (!isDispatchMarker(c.body)) return false;
            const markerStint = extractMarkerStint(c.body);
            if (stintStart !== null && markerStint !== null) {
              return markerStint === stintStart;
            }
            // Couldn't resolve a stint on one side or the other — fall back to a short window
            // rather than either blocking dispatch forever or never deduping at all.
            const commentTime = new Date(c.created).getTime();
            return Date.now() - commentTime < DISPATCH_DEDUPE_WINDOW_MS;
          });
        } catch {
          // Can't confirm either way — fail open and dispatch rather than silently drop the issue.
        }
      }

      if (alreadyDispatched) {
        result.skipped = true;
        return;
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
        result.dispatched = await dispatchToAgent(issue, agentSlug, stintStart);
        markDispatchedLocally(issue.key, stintStart);

        // 5. Post comment on Jira issue — as the agent's own account once it has a token
        // configured (see jiraCommentCredentialsForAgent above), Roger's shared credential
        // otherwise.
        await addJiraComment(
          issue.key,
          `🤖 Sent to ${agentSlug} for triage and assignment.\n${buildDispatchMarker(stintStart)}`,
          jiraCommentCredentialsForAgent(agentSlug),
        ).catch((err) => {
          console.error(`Failed to post dispatch marker comment on ${issue.key}:`, err);
          return null;
        });

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
    });

    results.push(result);
  }

  const summary = {
    total: results.length,
    dispatched: results.filter((r) => r.dispatched).length,
    errors: results.filter((r) => r.error).length,
    skipped: results.filter((r) => r.skipped).length,
    dryRun,
  };

  return { summary, dispatched: results };
}
