# Jira Dispatch: Switch to the `agent` RPC Method — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `dispatchToAgent()` in `src/lib/jira-dispatch.ts` so newly dispatched Jira tickets actually reach an OpenClaw agent, and get the agent's real reply posted to Slack once it's ready.

**Architecture:** Swap the gateway RPC call from the low-level `sessions.send` (which requires the target session to already exist, and throws `INVALID_REQUEST: session not found` for a brand-new per-ticket key — this is why NEURALOPS-30 silently died) to the higher-level `agent` method, which resolves/creates the session and supports native delivery + idempotency. The params-building logic (session key, delivery shape, idempotency key) is extracted into a new pure, dependency-free function in `src/lib/jira-agent-session.ts` — the file this codebase already uses for exactly this kind of unit-testable logic, since `jira-dispatch.ts` itself has `@/`-aliased imports this test suite has no mocking convention for yet.

**Tech Stack:** TypeScript, Next.js, `node --test` (Node v26), no new dependencies.

## Global Constraints

- Session key scheme is unchanged: `agent:<agentSlug>:<issueKey>` (from `sessionKeyForTicket`, already in `jira-agent-session.ts` — don't touch it).
- `runAutoDispatch`'s existing steps 1–3 (transition to In Progress, assign to the agent's Jira account, immediate Slack ping) keep their current code and timing unchanged — see `docs/superpowers/specs/2026-08-07-jira-dispatch-agent-rpc-fix-design.md`, "Two-message timing."
- The existing comment-marker + in-process-lock dedupe mechanism (`isDispatchMarker`, `dispatchLocks`, `localDispatchMarks`) is **not** removed or replaced — it protects a different failure mode than the RPC's native `idempotencyKey` (see design doc, "Idempotency" section). Add `idempotencyKey`, don't touch the rest.
- If the Slack channel can't be resolved, dispatch must still proceed (without native delivery) rather than fail the whole ticket dispatch — delivery is a bonus, not a precondition for getting the ticket to the agent.
- Test convention: colocated `<name>.test.mjs` next to `<name>.ts`, run via `node --test 'src/**/*.test.mjs'`. No new test infrastructure — follow the existing pure-helper pattern in `jira-agent-session.ts`/`jira-agent-session.test.mjs` (TS transpiled via `typescript`'s `transpileModule` to CommonJS, loaded with a `new Function` wrapper — see that test file's `loadTypeScriptModule` helper).
- Do not skip the manual production verification in Task 2 — the previous fix (PR #27) shipped with an unchecked "manual production verification" box, and that's precisely how this bug went undetected for two weeks.

---

### Task 1: Add `buildAgentDispatchParams` and wire it into `dispatchToAgent`

**Files:**
- Modify: `src/lib/jira-agent-session.ts` (add `buildAgentDispatchParams` + `AgentDispatchParams`)
- Modify: `src/lib/jira-agent-session.test.mjs` (append 3 new tests)
- Modify: `src/lib/jira-dispatch.ts:13-27` (imports), `:181-202` (`dispatchToAgent`), `:319` (call site)

**Interfaces:**
- Produces: `buildAgentDispatchParams(params: { agentSlug: string; issueKey: string; message: string; stintStart: number | null; slackChannelId: string | null }): AgentDispatchParams`, exported from `@/lib/jira-agent-session`.
- Produces: `AgentDispatchParams` type: `{ sessionKey: string; message: string; deliver: boolean; channel?: "slack"; to?: string; idempotencyKey: string }`, exported from `@/lib/jira-agent-session`.
- Consumes (unchanged, already exist): `sessionKeyForTicket(agentSlug, issueKey): string` from the same file; `resolveChannelId(channelName: string): Promise<string | null>` from `@/lib/slack`; `callGateway<T>(method: string, params?: unknown): Promise<T>` from `@/lib/gateway`.

- [x] **Step 1: Write the failing tests for `buildAgentDispatchParams`**

Append to `src/lib/jira-agent-session.test.mjs` (after the existing `decideCommentRelay` tests, same file — `loadModule()` is already defined at the top and needs no changes):

```js
test("buildAgentDispatchParams enables native Slack delivery when the channel resolves", () => {
  const { buildAgentDispatchParams } = loadModule();
  const result = buildAgentDispatchParams({
    agentSlug: "sage",
    issueKey: "NEURALOPS-30",
    message: "New ticket ready for triage: NEURALOPS-30 — Create blog posts",
    stintStart: 1754593200000,
    slackChannelId: "C0BCWK5814L",
  });
  assert.deepEqual(result, {
    sessionKey: "agent:sage:NEURALOPS-30",
    message: "New ticket ready for triage: NEURALOPS-30 — Create blog posts",
    deliver: true,
    channel: "slack",
    to: "channel:C0BCWK5814L",
    idempotencyKey: "NEURALOPS-30:1754593200000",
  });
});

test("buildAgentDispatchParams disables delivery without failing dispatch when the channel can't be resolved", () => {
  const { buildAgentDispatchParams } = loadModule();
  const result = buildAgentDispatchParams({
    agentSlug: "sage",
    issueKey: "NEURALOPS-30",
    message: "New ticket ready for triage: NEURALOPS-30 — Create blog posts",
    stintStart: 1754593200000,
    slackChannelId: null,
  });
  assert.deepEqual(result, {
    sessionKey: "agent:sage:NEURALOPS-30",
    message: "New ticket ready for triage: NEURALOPS-30 — Create blog posts",
    deliver: false,
    idempotencyKey: "NEURALOPS-30:1754593200000",
  });
});

test("buildAgentDispatchParams falls back to an 'unknown' idempotency suffix when the stint can't be resolved", () => {
  const { buildAgentDispatchParams } = loadModule();
  const result = buildAgentDispatchParams({
    agentSlug: "sage",
    issueKey: "NEURALOPS-30",
    message: "New ticket ready for triage: NEURALOPS-30 — Create blog posts",
    stintStart: null,
    slackChannelId: "C0BCWK5814L",
  });
  assert.equal(result.idempotencyKey, "NEURALOPS-30:unknown");
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd ~/workspace/tenacitos && node --test src/lib/jira-agent-session.test.mjs`
Expected: the 3 new tests FAIL with something like `buildAgentDispatchParams is not a function` (it doesn't exist yet). The existing tests in this file still PASS.

- [x] **Step 3: Implement `buildAgentDispatchParams` in `jira-agent-session.ts`**

Append to the end of `src/lib/jira-agent-session.ts` (after `decideCommentRelay`):

```ts
// Params for the gateway's "agent" RPC method (see
// docs/superpowers/specs/2026-08-07-jira-dispatch-agent-rpc-fix-design.md). Unlike the
// lower-level "sessions.send" RPC, "agent" resolves/creates the session named by sessionKey —
// which is why dispatchToAgent in jira-dispatch.ts uses it instead. Delivery is best-effort:
// when the Slack channel can't be resolved, dispatch still proceeds without native delivery
// rather than failing the whole ticket dispatch over a notification nicety.
export interface AgentDispatchParams {
  sessionKey: string;
  message: string;
  deliver: boolean;
  channel?: "slack";
  to?: string;
  idempotencyKey: string;
}

export function buildAgentDispatchParams(params: {
  agentSlug: string;
  issueKey: string;
  message: string;
  stintStart: number | null;
  slackChannelId: string | null;
}): AgentDispatchParams {
  const { agentSlug, issueKey, message, stintStart, slackChannelId } = params;
  const sessionKey = sessionKeyForTicket(agentSlug, issueKey);
  const idempotencyKey = `${issueKey}:${stintStart ?? "unknown"}`;

  if (!slackChannelId) {
    return { sessionKey, message, deliver: false, idempotencyKey };
  }

  // "channel:<id>" is the Slack target form the gateway's native Slack channel plugin expects
  // for addressing a channel (as opposed to "user:<id>" or a raw <@id> mention) — see
  // docs/channels/slack.md ("Slack target forms") in the openclaw/openclaw image.
  return {
    sessionKey,
    message,
    deliver: true,
    channel: "slack",
    to: `channel:${slackChannelId}`,
    idempotencyKey,
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/workspace/tenacitos && node --test src/lib/jira-agent-session.test.mjs`
Expected: all tests PASS, including the 3 new ones and every pre-existing test in this file.

- [x] **Step 5: Wire `dispatchToAgent` in `jira-dispatch.ts` to use the new helper and the `agent` RPC method**

In `src/lib/jira-dispatch.ts`, change the imports (lines 13–27) from:

```ts
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
import { sessionKeyForTicket } from "@/lib/jira-agent-session";
import { sendSlackMessage } from "@/lib/slack";
import { callGateway } from "@/lib/gateway";
import { createNotification } from "@/lib/notifications";
```

to:

```ts
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
```

Then replace the whole `dispatchToAgent` function (lines 181–202):

```ts
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
```

with:

```ts
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
  const channelId = await resolveChannelId(NOTIFY_CHANNEL).catch(() => null);
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
```

Finally, update the call site (was line 319) from:

```ts
        result.dispatched = await dispatchToAgent(issue, agentSlug);
```

to:

```ts
        result.dispatched = await dispatchToAgent(issue, agentSlug, stintStart);
```

(`stintStart` is already in scope at that call site — it's declared earlier in the same `withDispatchLock` callback.)

- [x] **Step 6: Run the full test suite, typecheck, and lint**

Run: `cd ~/workspace/tenacitos && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS, no type errors, no lint errors. If `tsc` complains about the `channel?: "slack"` literal type when spread into `callGateway`'s `params?: unknown`, that's expected to be fine since `unknown` accepts any value — if it isn't, check whether `AgentDispatchParams` needs to be passed through an explicit cast; don't silently loosen the type to `any`.

- [x] **Step 7: Commit**

```bash
cd ~/workspace/tenacitos
git add src/lib/jira-agent-session.ts src/lib/jira-agent-session.test.mjs src/lib/jira-dispatch.ts
git commit -m "$(cat <<'EOF'
fix: dispatch Jira tickets via the agent RPC method, not sessions.send

sessions.send requires the target session to already exist; the
per-ticket session keys introduced in PR #27 are always new, so every
dispatch through that path has been silently failing with
INVALID_REQUEST: session not found since PR #27 merged. NEURALOPS-30 is
the first real ticket to hit it. The agent RPC method resolves/creates
the session and adds native delivery + idempotency as a side benefit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Deploy and manually verify against the live gateway

**Files:** none (operational task — no code changes)

**Interfaces:**
- Consumes: the merged fix from Task 1, deployed to the running `openclaw-tenacitos-1` container.

This is a manual/production-gated task — do not treat it as optional or automatable. The point of this task existing is that the previous fix (PR #27) shipped with an equivalent step unchecked, and that is specifically how the `sessions.send` bug went undetected in production for two weeks.

- [x] **Step 1: Push the branch and open a PR**

```bash
cd ~/workspace/tenacitos
git push -u origin fix/jira-dispatch-agent-rpc
gh pr create --title "fix: dispatch Jira tickets via the agent RPC method, not sessions.send" --body "$(cat <<'EOF'
## Summary
- `dispatchToAgent()` was calling the low-level `sessions.send` RPC on a brand-new per-ticket
  session key, which the gateway rejects with `INVALID_REQUEST: session not found` — this RPC
  requires the session to already exist. Confirmed live for NEURALOPS-30.
- Switches to the gateway's `agent` RPC method, which resolves/creates the session, and adds
  native delivery (posts the agent's actual reply to `#dev` once its turn completes) and a native
  `idempotencyKey`.

Design spec: `docs/superpowers/specs/2026-08-07-jira-dispatch-agent-rpc-fix-design.md`
Implementation plan: `docs/superpowers/plans/2026-08-07-jira-dispatch-agent-rpc-fix.md`

## Test plan
- [x] `npm test` — all passing
- [x] `npm run lint` — clean
- [x] `npx tsc --noEmit` — clean
- [x] Manual production verification (see plan Task 2) — do not merge without checking this box

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Follow the standing PR-review workflow (wait for the Codex bot review or clean-PR reaction, address any findings, resolve threads) before merging.

- [x] **Step 2: Deploy the merged fix**

After the PR merges, from `~/workspace/openclaw-terraform`:

```bash
./setup-mission-control.sh
```

This pulls `tenacitos`'s latest `main` on the box and rebuilds/restarts the `tenacitos` service. Confirm it picked up the new commit:

```bash
./status.sh
```

Expected: the `tenacitos` line shows the new commit hash with `✓ up to date` (not `⚠ behind origin`).

- [x] **Step 3: Watch the gateway log while re-triggering NEURALOPS-30's dispatch**

Open a log tail first:

```bash
ssh ubuntu@openclaw.neuralops.ca "docker logs -f openclaw-openclaw-gateway-1" | grep -i "agent\|sessions.send\|NEURALOPS-30"
```

**Do not use the dashboard's "Dispatch to Max" button for this** — it posts to `/api/agents/dispatch` (`src/app/(dashboard)/jira/page.tsx`'s `handleDispatch`), which still calls the old `sessions.send` RPC directly (`src/app/api/agents/dispatch/route.ts:30`) against the unrelated, long-lived `agent:main:main` session. That button exercises neither the code this branch changed nor NEURALOPS-30's actual per-ticket session — it would not validate this fix.

Instead, hit `/api/jira/auto-dispatch` directly with `issueKey: "NEURALOPS-30"` — this is the route that calls the now-fixed `runAutoDispatch()`/`dispatchToAgent()`, and bypasses the "To Do"-only filter that applies when no `issueKey` is given (NEURALOPS-30 is already "In Progress"). This route is gated by the `mc_auth` cookie, whose value is just `AUTH_SECRET` directly (`src/proxy.ts`'s `isAuthenticated`) — no login flow needed, just the secret itself:

```bash
ssh ubuntu@openclaw.neuralops.ca "grep '^AUTH_SECRET=' /opt/openclaw-data/workspace/mission-control/.env.local | cut -d= -f2-"
# then, from a machine that can reach mc.neuralops.ca (or over the SSH tunnel):
curl -s -X POST https://mc.neuralops.ca/api/jira/auto-dispatch \
  -H "Cookie: mc_auth=<AUTH_SECRET from above>" \
  -H "Content-Type: application/json" \
  -d '{"issueKey":"NEURALOPS-30"}'
```

Expected response: `{"summary":{"total":1,"dispatched":1,...},...}` with `dispatched:1`, not `skipped:1` (a `skipped` result means the existing marker-comment dedupe decided this was already handled — check `alreadyDispatched` reasoning in `jira-dispatch.ts` if that happens) and not an `error` field.

Expected in the gateway log: a `res ✓` (not `res ✗`) for method `agent` — not `sessions.send` — with no `INVALID_REQUEST`/`session not found`.

- [x] **Step 4: Confirm the Jira comment and the (new) Slack reply both land**

Check `https://neuralops.atlassian.net/browse/NEURALOPS-30` for the `🤖 Sent to sage for triage and assignment.` marker comment (this already worked before the fix — confirms it's still not regressed), and watch `#dev` in Slack for a **second**, later message once the agent's turn completes — this is the new native-delivery behavior and did not happen before this fix. If it doesn't appear within a few minutes, check the gateway log for the run's completion and any delivery error.

## Verified 2026-08-08

Task 2 was executed against production after merge (PR #29). First attempt caught a real deploy-ordering gap: `./setup-mission-control.sh` was run before the merge commit's own "Build & Deploy" GitHub Actions run had finished publishing the `:latest` image, so it silently redeployed the stale two-week-old image (`org.opencontainers.image.revision=7efaca7`) — the auto-dispatch call correctly reproduced the original `session not found` error, exactly as designed to catch this class of mistake. Waited for the GH Actions run to reach `completed`/`success` (its own `Deploy` job redeployed the container automatically), confirmed the running image's revision label matched the merge commit (`00b9ee1`), then re-ran verification:

- `POST /api/jira/auto-dispatch {"issueKey":"NEURALOPS-30"}` → `{"summary":{"total":1,"dispatched":1,"errors":0,"skipped":0},...}`
- Gateway log: `res ✓ agent 233ms runId=NEURALOPS-30:1786154322619` (method `agent`, not `sessions.send`; no `INVALID_REQUEST`)
- Jira: real triage comment posted (NEURALOPS-30#comment-10269) — resume/JD alignment map, gap analysis, and a follow-up dispatch to another agent for the actual deliverable
- Slack `#dev`: the new native-delivery message landed (2026-08-08 01:54:15 PDT, ts `1786179255.714479`) — the agent's real triage summary, not just the static "sent for triage" ping

First genuinely successful end-to-end run of this pipeline.
