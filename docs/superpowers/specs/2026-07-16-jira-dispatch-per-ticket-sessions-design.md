# Jira Dispatch Pipeline: Per-Ticket Sessions + Human-Reply Relay — Design

Date: 2026-07-16
Status: Approved for implementation

## Context

The Jira↔agent auto-dispatch pipeline (`src/lib/jira-dispatch.ts`, `src/app/api/jira/webhook/route.ts`)
routes every "To Do" NEURALOPS ticket to Sage via a native Jira webhook. Two related bugs surfaced
while debugging a real stuck ticket (NEURALOPS-23, "Add Cloud Infra costs to `/costs`"):

1. **No inbound relay.** The webhook only relays *outbound* agent→human messages: an agent
   posting a comment starting with `NEEDS INPUT:` gets forwarded to Slack `#dev`. There is no
   matching path for a human's reply (a plain Jira comment, or a Slack thread reply) to reach the
   agent. Roger answered Sage's blocking questions on NEURALOPS-23 directly in a Jira comment and
   in the Slack thread; neither reached Sage.
2. **Single shared session serializes unrelated tickets.** Every dispatch — regardless of which
   ticket — calls `callGateway("sessions.send", { key: \`agent:${agentSlug}:main\`, ... })`. All
   tickets dispatched to Sage land in the *same* fixed session, so they're not independent units
   of work to Sage; they're sequential messages in one ongoing conversation. When ticket #23
   blocked mid-conversation waiting on Roger, three unrelated Metro Mayhem tickets
   (NEURALOPS-24/25/26) got explicitly queued behind it in Sage's own triage comments, instead of
   being picked up immediately.

**Uncommitted WIP found in the working tree:** a complete, working implementation of per-agent
Jira service-account assignment (`AGENT_JIRA_ACCOUNT_ENV` map, `jiraAccountIdForAgent()`,
`assignIssue()` in `jira.ts`, `.env.example` additions, `docs/jira-agent-accounts.md`) was sitting
uncommitted. It's unrelated to this fix but touches the same function (`runAutoDispatch`). Per
Roger, this gets committed first as its own commit, and the session-keying fix is built on top of
it — not discarded, not merged into the same commit.

**Explicitly out of scope:**
- Slack thread-reply relay (separate follow-up; needs Slack Events API + thread↔issue-key
  mapping, which doesn't exist today).
- Migrating the already-in-flight NEURALOPS-23/24/25/26 conversations currently sitting in the
  old shared `agent:sage:main` session — operational cleanup, not a code change, and blocked on
  an unrelated SSH tunnel host-key issue (`com.neuralops.openclaw-tunnel`) that currently prevents
  reaching the gateway from this machine at all.
- The `JIRA_ACCOUNT_ID_*` provisioning gap (accounts not yet created for most agents) — that's
  Jira admin setup, not a bug, and already documented in `docs/jira-agent-accounts.md`.

## Design

### Per-ticket sessions

`dispatchToAgent` in `jira-dispatch.ts` changes its session key from the hardcoded
`agent:${agentSlug}:main` to `agent:${agentSlug}:${issue.key}` (e.g. `agent:sage:NEURALOPS-24`).
This is the single change that fixes bug #2: each ticket becomes a fully independent conversation
in the gateway's session store, so a blocked ticket has no mechanism by which it could hold up
another ticket's dispatch — there's no shared thread left for them to compete over.

This also removes the need for any state-tracking to solve bug #1: once sessions are per-ticket,
"where does a reply to this ticket's question go" has an unambiguous answer — the same session
key the ticket was originally dispatched to.

### Human-reply relay

The webhook (`route.ts`) gains a new branch, evaluated after the existing `NEEDS_INPUT_MARKER`
check (which stays first and unchanged — an agent's own outbound "NEEDS INPUT:" comment must
still page Slack, not loop back into its own session):

- Trigger: a `comment_created` webhook event carrying a non-empty `comment.body`.
- Filter out the bot's own status comments: since `addJiraComment` posts using Roger's own Jira
  API token (there's no dedicated "Sage" Jira account posting comments — that's a separate,
  unrelated gap from the per-agent *assignment* accounts), every comment shows the same Jira
  author regardless of whether a human or the bot wrote it. Filtering by author is therefore not
  possible; filter by content instead. The bot's own comments already consistently start with
  `🤖` (see the existing `Sent to ${agentSlug} for triage...` template) — skip relay for any
  comment body starting with `🤖`.
- Filter out premature relays: skip if the issue is still in `To Do` status (never dispatched, so
  `agent:sage:<key>` doesn't exist yet as a meaningful session — nothing useful to relay into).
- Otherwise: relay the comment's plain text into `agent:sage:<issueKey>` via
  `callGateway("sessions.send", { key: \`agent:sage:${issueKey}\`, message, timeoutMs: 0 })`,
  prefixed with enough context that Sage doesn't need to re-fetch the ticket to know what this is
  (issue key, "Roger replied on the ticket:" framing, the comment text).
- No "was there an outstanding question" state is tracked. Any human comment on a ticket already
  being worked is relayed; the agent (now with full per-ticket conversation history) decides
  what's relevant. This was chosen over precise state-tracking because it's simpler, has no way
  to desync, and per-ticket sessions already scope the noise to just that ticket's own thread.

### Data flow

```
Jira webhook (comment_created, issue NEURALOPS-24)
  -> commentBody starts with "🤖"?          -> yes: no-op (bot's own comment)
  -> issue.status == "To Do"?               -> yes: no-op (never dispatched)
  -> otherwise: callGateway("sessions.send", {
       key: "agent:sage:NEURALOPS-24",
       message: "Roger replied on NEURALOPS-24: <comment text>",
       timeoutMs: 0,
     })

Jira webhook (issue_created / moved to To Do, issue NEURALOPS-27)
  -> runAutoDispatch -> dispatchToAgent(issue, "sage")
  -> callGateway("sessions.send", { key: "agent:sage:NEURALOPS-27", message: <dispatch brief>, timeoutMs: 0 })
```

### Error handling

- `callGateway` failures (gateway unreachable, as we're currently experiencing via the broken SSH
  tunnel) should fail the same way the existing `dispatchToAgent` call already does — caught by
  `runAutoDispatch`'s existing per-issue try/catch, recorded in `DispatchResult.error`, not thrown
  uncaught. The new webhook relay branch should similarly catch and swallow gateway errors
  (`.catch(() => null)`, matching the existing pattern for `addJiraComment`/`createNotification`
  calls in this file) rather than fail the whole webhook request over a best-effort relay.
- A comment on an issue key the pipeline has never heard of (e.g. a ticket outside `NEURALOPS`,
  though the webhook's `jqlFilter` should already exclude these at the Jira level) is a no-op —
  `sessions.send` to a session key the gateway has never seen either fails or silently creates an
  orphaned session; either is acceptable since it shouldn't be reachable given the webhook's JQL
  filter.

## Testing

This repo has a real test suite: `node --test 'src/**/*.test.mjs'`, colocated `.test.mjs` files
next to source (e.g. `src/lib/slack.test.mjs`). Follow that convention:

- `src/lib/jira-dispatch.test.mjs` (new): unit test that `dispatchToAgent` builds the session key
  as `agent:${agentSlug}:${issue.key}`, not `agent:${agentSlug}:main` — mock `callGateway` and
  assert on the `key` param it's called with.
- `src/app/api/jira/webhook/route.test.mjs` (new, first test file for this route): unit tests for
  the new relay branch — a comment starting with `🤖` does not call `callGateway`; a comment on a
  `To Do` issue does not call `callGateway`; a comment on an `In Progress` issue not starting with
  `🤖` does call `callGateway` with the expected session key and message; the existing
  `NEEDS_INPUT_MARKER` branch still fires Slack + notification and does *not* also fall through
  to the new relay branch (they're mutually exclusive via early return, matching current code
  structure).
- No integration/E2E test against a live Jira/gateway — mock `getSingleIssue`, `callGateway`,
  `sendSlackMessage` at the module boundary, matching how `slack.test.mjs` already mocks `fetch`.
