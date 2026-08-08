# Jira Dispatch Pipeline: Switch to the `agent` RPC Method — Design

Date: 2026-08-07
Status: Approved for implementation

## Context

`dispatchToAgent()` in `src/lib/jira-dispatch.ts` sends every auto-dispatched Jira ticket into the
gateway with:

```ts
const sessionKey = sessionKeyForTicket(agentSlug, issue.key); // "agent:sage:NEURALOPS-30"
await callGateway("sessions.send", { key: sessionKey, message, timeoutMs: 0 });
```

This has been broken since PR #27 (merged 2026-07-24) introduced per-ticket session keys.
`sessions.send` is a low-level RPC method that requires the target session to already exist — it
does not create one. Every ticket dispatched before that PR used a long-lived, already-existing
shared session (`agent:sage:main`), so the gap was invisible. NEURALOPS-30 ("Create blog posts
fitting requirements of a job description," dispatched 2026-08-07) is the **first real ticket** to
go through the per-ticket code path in production, and it failed immediately:

```
[ws] res ✗ sessions.send errorCode=INVALID_REQUEST
  errorMessage=session not found: agent:sage:NEURALOPS-30
```

Because this call sits inside the same try block as the Jira "dispatched" comment (step 5) and the
TenacitOS notification (step 6), the thrown `GatewayError` short-circuits both. The ticket is left
transitioned to "In Progress" with a Slack ping already sent (steps 1–3 ran first), but nothing
ever follows up — no triage comment, no error surfaced anywhere except one line in the gateway's
own container log. This matches the pattern on NEURALOPS-23/26/29 as well, though those may have
distinct root causes from before the per-ticket-session change; only NEURALOPS-30 has been traced
to this specific bug.

**Root cause, precisely:** `jira-dispatch.ts` talks to the gateway one abstraction level lower
than OpenClaw's own architecture expects for this pattern. The gateway exposes a separate,
higher-level `agent` RPC method (distinct from the `sessions.*` group — confirmed in the gateway's
own method registry, `loadAgentHandlers`) that resolves/creates the target session itself and
additionally supports native delivery (`deliver`/`channel`/`to`) and idempotency
(`idempotencyKey`). This is the same method `openclaw gateway call agent` and `/hooks/agent` use,
and is the pattern the OpenClaw maintainers point to (see
[openclaw/openclaw#52468](https://github.com/openclaw/openclaw/issues/52468)) for exactly this
"external system needs to inject into an addressable session" use case — as opposed to
`/hooks/agent`'s default isolated-per-call sessions, which don't fit a per-ticket conversation that
later replies need to land back in.

**Explicitly out of scope** (real gaps, but orthogonal to this bug — separate follow-ups):
- NEURALOPS-27: persisting a ticket→session/agent mapping so the webhook's comment-relay routes
  correctly for non-default-agent dispatches or the dashboard's manual "Dispatch to Max" button.
  Triaged and approved 3 weeks ago, never implemented.
- A watchdog for tickets that get dispatched but never receive further agent activity — the
  general "silent failure" problem this bug is one instance of.
- The Claude Max weekly rate-limit `FailoverError`s observed in the gateway log around
  2026-08-07T18:57–19:57 UTC — a separate capacity/resilience concern, unrelated to this session
  bug (NEURALOPS-30's dispatch attempt at 01:58 UTC the next day was well after that window).

## Design

### Dispatch call: `sessions.send` → `agent`

`dispatchToAgent()` swaps its RPC call. Session key scheme is unchanged
(`sessionKeyForTicket(agentSlug, issue.key)`); only the method and param shape change:

```ts
await callGateway("agent", {
  sessionKey,
  message,
  deliver: true,
  channel: "slack",
  to: /* resolved Slack identifier — see "Delivery target" below, must be verified, not assumed */,
  idempotencyKey: `${issue.key}:${stintStart ?? "unknown"}`,
});
```

The `agent` method resolves (creating if necessary) the session identified by `sessionKey` before
sending — this is the actual fix. It returns once the run is *admitted*, not once the agent
finishes responding (same admission-then-async-completion shape as `/hooks/agent`), so nothing
about the surrounding step ordering in `runAutoDispatch` needs to change.

### Delivery target

The gateway has its own native Slack channel configured (`channels.slack` in `openclaw.json`,
sourcing `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN` from env) — separate from tenacitos's own
`sendSlackMessage()` (`src/lib/slack.ts`), which calls the Slack Web API directly with its own
`SLACK_BOT_TOKEN`/`SLACK_CHANNEL_DEV` env vars. These may or may not point at the same bot/channel
identifier format. **Before wiring `to` in the implementation, confirm empirically** (a manual
`callGateway("agent", ...)` test call, or reading the gateway's Slack channel plugin source) what
identifier form it expects — a channel ID like `SLACK_CHANNEL_DEV`'s value, or something else.
Don't assume it matches tenacitos's own convention without checking; this class of assumption is
exactly what went unverified in PR #27 (its test plan had a manual-production-verification box
that was never actually checked, which is how this bug shipped invisibly for two weeks).

### Two-message timing (confirmed with Roger)

This is a deliberate behavior change, not just a bug fix:

1. **Unchanged:** the existing steps 1–3 in `runAutoDispatch` (transition to In Progress, assign
   to the agent's Jira account, immediate Slack ping "🤖 NEURALOPS-30 sent to sage for triage")
   keep their current synchronous timing and wording.
2. **New:** once the agent's turn actually completes (which can take 15–30+ seconds for a real
   triage turn, per observed gateway logs), native delivery posts the agent's *real* output to
   `#dev` automatically. Today, the only way anything comes back is if the agent itself remembers
   to post a Jira comment via its own tooling — which is what silently didn't happen for
   NEURALOPS-30, -23, -26, and -29. This closes that gap generically, not just for Jira tickets.

The existing step 5 (posting the `🤖 Sent to ${agentSlug} for triage and assignment.` marker
comment on the Jira issue) is unchanged and still fires right after the `agent` call returns
(admission, not completion) — it's a dispatch-confirmation marker, not a reply.

### Idempotency: hand-rolled → native `idempotencyKey`

The existing dedupe mechanism (`isDispatchMarker`/`extractMarkerStint` comment-scanning +
`dispatchLocks`/`localDispatchMarks` in-process tracking, ~60 lines) stays as-is for this change —
**not** replaced. Investigating during design, the existing mechanism protects against a different
failure mode than the RPC's native `idempotencyKey`: it dedupes across *separate webhook
deliveries* for the same status transition (Jira redelivering `issue_created` + `issue_updated`
near-simultaneously), which happens *before* `dispatchToAgent()` is ever called and gates whether
`runAutoDispatch`'s whole per-issue block (transition + assign + Slack + dispatch + comment) runs
at all. The RPC's `idempotencyKey` only dedupes the single `agent` call itself. Passing one is
still worthwhile — cheap insurance against a retried `agent` call specifically (e.g. a network
retry inside `callGateway`, if one is ever added) — but it doesn't replace the existing
comment-marker mechanism, which operates at a different layer. Built from
`` `${issue.key}:${stintStart ?? "unknown"}` `` to match the existing stint-based dedupe identity
used elsewhere in this file.

### Error handling

Unchanged: the `agent` call is still inside `runAutoDispatch`'s existing per-issue try/catch. A
thrown `GatewayError` (e.g. gateway unreachable, bad token) is still caught and recorded in
`DispatchResult.error` — this design does not add alerting/monitoring on that field (out of
scope, see above), but does not regress it either.

## Testing

This repo has a real test suite: `node --test 'src/**/*.test.mjs'`, colocated `.test.mjs` files.
No test file exists yet for `jira-dispatch.ts` — this is the first one:

- `src/lib/jira-dispatch.test.mjs` (new): mock `callGateway` and assert `dispatchToAgent`
  calls it with method `"agent"` (not `"sessions.send"`) and params
  `{ sessionKey, message, deliver: true, channel: "slack", to: <resolved value>, idempotencyKey }`.
  Assert the session key is still `agent:${agentSlug}:${issue.key}` (unchanged from PR #27).
- Manual production verification (do not skip this time): after deploying, trigger a real test
  ticket through the full pipeline and confirm in the gateway log that `agent` (not
  `sessions.send`) is called, the session resolves without an `INVALID_REQUEST`, and the delivered
  Slack message actually lands in `#dev` once the agent's turn completes.
