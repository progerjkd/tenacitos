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
  addJiraComment,
  getIssueComments,
  getCurrentToDoStintStart,
  type JiraIssue,
} from "@/lib/jira";
import { sendSlackMessage } from "@/lib/slack";
import { callGateway } from "@/lib/gateway";
import { createNotification } from "@/lib/notifications";

const PROJECT = "NEURALOPS";
const DEFAULT_AGENT = "sage";
const NOTIFY_CHANNEL = "#dev";

// Marker left on the Jira comment posted by step 4 below. Jira can deliver more than one
// qualifying webhook event for the same status change (e.g. issue_created firing alongside a
// near-simultaneous issue_updated into "To Do"), and runAutoDispatch has no other memory across
// calls — so re-check this marker before doing anything, rather than dispatching blind every time
// an issue is seen in "To Do".
//
// A marker only counts as "already dispatched" if it was posted during the issue's *current*
// stint in "To Do" (per getCurrentToDoStintStart) — not merely recently. Time alone can't tell
// apart a duplicate delivery of the same transition from a legitimate one (an issue can genuinely
// cycle back into "To Do" seconds after leaving it — a fixed window would swallow that dispatch
// too, and nothing would ever retry it since there's no scheduled follow-up). DISPATCH_DEDUPE_WINDOW_MS
// is only the fallback when the stint lookup itself fails.
const DISPATCH_MARKER = "Auto-dispatched via TenacitOS Mission Control.";
const DISPATCH_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

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
const localDispatchMarks = new Map<string, number>();

function markDispatchedLocally(key: string): void {
  const now = Date.now();
  for (const [k, ts] of localDispatchMarks) {
    if (now - ts >= DISPATCH_DEDUPE_WINDOW_MS) localDispatchMarks.delete(k);
  }
  localDispatchMarks.set(key, now);
}

// Same stint-scoping as the Jira comment marker (see DISPATCH_MARKER above) — otherwise this
// fallback reintroduces the exact bug it was added to guard against, just via a different path:
// blocking a legitimate rapid re-dispatch with no way to recover since nothing retries it.
function wasDispatchedLocallyRecently(key: string, stintStart: number | null): boolean {
  const ts = localDispatchMarks.get(key);
  if (ts === undefined) return false;
  if (stintStart !== null) return ts >= stintStart;
  return Date.now() - ts < DISPATCH_DEDUPE_WINDOW_MS;
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

  // Always targets Sage's own persistent session (not a per-ticket one) — Sage is the
  // one long-lived agent in this pipeline; it fans work out to isolated specialist
  // sessions itself via its native subagent (allowAgents) capability.
  const sessionKey = `agent:${agentSlug}:main`;
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
      slackNotified: false,
    };

    if (dryRun) {
      result.dispatched = true;
      result.transitioned = true;
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
          const comments = await getIssueComments(issue.key);
          const now = Date.now();
          alreadyDispatched = comments.some((c) => {
            if (!c.body.includes(DISPATCH_MARKER)) return false;
            const commentTime = new Date(c.created).getTime();
            if (stintStart !== null) return commentTime >= stintStart;
            // Couldn't resolve the current stint — fall back to a short window rather than
            // either blocking dispatch forever or never deduping at all.
            return now - commentTime < DISPATCH_DEDUPE_WINDOW_MS;
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

        // 2. Send Slack notification — also happens before dispatch, for the
        // same reason: the dispatch message claims it's already gone out.
        const slackText = `🤖 *${issue.key}* sent to \`${agentSlug}\` for triage\n*${issue.summary}*\n<${issue.url}|View in Jira>`;
        const slackResult = await sendSlackMessage(NOTIFY_CHANNEL, slackText);
        result.slackNotified = slackResult.ok;

        // 3. Dispatch to agent — only now, once the state it references is
        // actually true.
        result.dispatched = await dispatchToAgent(issue, agentSlug);
        markDispatchedLocally(issue.key);

        // 4. Post comment on Jira issue
        await addJiraComment(
          issue.key,
          `🤖 Sent to ${agentSlug} for triage and assignment.\n${DISPATCH_MARKER}`,
        ).catch(() => null);

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
