# Jira Dispatch Per-Ticket Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in the Jira↔agent auto-dispatch pipeline: give every ticket its own
independent agent session (so a blocked ticket can't serialize unrelated work behind it), and
relay human Jira-comment replies into that session (so answering a blocking question actually
reaches the agent).

**Architecture:** Extract the two behavior-determining decisions — how a ticket's session key is
built, and whether/where an inbound comment should be relayed — into a small, dependency-free
pure-function module. `jira-dispatch.ts` and the webhook route become thin callers of those
functions plus the existing `callGateway`/Jira/Slack clients.

**Tech Stack:** Next.js (App Router) API routes, TypeScript, `node --test` with inline
TS-transpile-and-eval test helpers (this repo's existing test pattern — no test framework
dependency).

## Global Constraints

- Session key format: `agent:${agentSlug}:${issueKey}` (e.g. `agent:sage:NEURALOPS-24`),
  replacing the old fixed `agent:${agentSlug}:main`.
- A comment is relayed only if: it has non-empty body text, it does NOT start with `🤖` (the
  existing marker for the bot's own auto-posted status comments — see
  `docs/superpowers/specs/2026-07-16-jira-dispatch-per-ticket-sessions-design.md`), and the
  issue's status is not `"To Do"` (an undispatched ticket has no session yet to relay into).
- The existing `NEEDS_INPUT_MARKER` (`/^needs input:/i`) branch in the webhook route is
  unchanged and stays first — an agent's own outbound "NEEDS INPUT:" comment must still page
  Slack, never loop back into its own session.
- Out of scope (per the design spec): Slack thread-reply relay, migrating already-in-flight
  conversations out of the old shared session, `JIRA_ACCOUNT_ID_*` provisioning.
- `npm run lint` and `npm test` (`node --test 'src/**/*.test.mjs'`) must both pass clean before
  any commit.

**Deviation from the design spec's Testing section, decided during planning:** the spec names
`src/lib/jira-dispatch.test.mjs` and `src/app/api/jira/webhook/route.test.mjs` as the new test
files, testing `dispatchToAgent` and the webhook route directly. That's not achievable with this
repo's existing test pattern: every current `.test.mjs` file loads its target by reading the
`.ts` source and transpiling+`import()`-ing it standalone (see `src/lib/activity-response.test.mjs`,
`src/lib/slack.test.mjs`) — none of them resolve the `@/*` TypeScript path alias, because that
resolution only exists inside Next.js's bundler, not in a plain `node --test` run. Every existing
tested file is therefore a dependency-free leaf module. `jira-dispatch.ts` and the webhook route
both import multiple `@/lib/*` modules (`gateway`, `jira`, `slack`, `notifications`) and would
fail to load under the existing test pattern. This plan instead extracts the actual
behavior-determining logic (session key format, relay decision) into a new dependency-free file
(`src/lib/jira-agent-session.ts`) that follows the existing leaf-module test pattern exactly, and
verifies the thin wiring in `jira-dispatch.ts`/the webhook route manually (dry-run flag / curl
against the local dev server) rather than inventing new test infrastructure. The design being
implemented is unchanged — only which file the tested logic lives in.

---

### Task 1: Pure session-key and comment-relay-decision helpers

**Files:**
- Create: `src/lib/jira-agent-session.ts`
- Test: `src/lib/jira-agent-session.test.mjs`

**Interfaces:**
- Produces: `sessionKeyForTicket(agentSlug: string, issueKey: string): string` and
  `decideCommentRelay(params: { issueKey: string; issueStatus: string; commentBody: string;
  agentSlug: string }): { relay: boolean; sessionKey?: string; message?: string }`. Task 2
  consumes `sessionKeyForTicket`; Task 3 consumes `decideCommentRelay`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/jira-agent-session.test.mjs`:

```javascript
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const loadedModule = { exports: {} };
  new Function("exports", "module", output)(loadedModule.exports, loadedModule);
  return loadedModule.exports;
}

function loadModule() {
  return loadTypeScriptModule(path.join(__dirname, "jira-agent-session.ts"));
}

test("sessionKeyForTicket builds one session key per ticket", () => {
  const { sessionKeyForTicket } = loadModule();
  assert.equal(sessionKeyForTicket("sage", "NEURALOPS-24"), "agent:sage:NEURALOPS-24");
  assert.equal(sessionKeyForTicket("playsmith", "NEURALOPS-7"), "agent:playsmith:NEURALOPS-7");
});

test("decideCommentRelay skips the bot's own status comments", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-24",
    issueStatus: "In Progress",
    commentBody: "🤖 Sent to sage for triage and assignment.\nAuto-dispatched via TenacitOS Mission Control.",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, { relay: false });
});

test("decideCommentRelay skips comments on tickets that haven't been dispatched yet", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-24",
    issueStatus: "To Do",
    commentBody: "any human comment",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, { relay: false });
});

test("decideCommentRelay skips empty comment bodies", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-24",
    issueStatus: "In Progress",
    commentBody: "",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, { relay: false });
});

test("decideCommentRelay relays a human reply on a ticket already in progress", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-23",
    issueStatus: "In Progress",
    commentBody: "1. AWS, adjust IAM as required. 2. neuralops-dev.",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, {
    relay: true,
    sessionKey: "agent:sage:NEURALOPS-23",
    message: "Roger replied on NEURALOPS-23: 1. AWS, adjust IAM as required. 2. neuralops-dev.",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/roger/workspace/tenacitos && node --test src/lib/jira-agent-session.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/jira-agent-session.ts'` (the source file
doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/jira-agent-session.ts`:

```typescript
/**
 * Pure helpers for the Jira <-> agent session pipeline: how a ticket's
 * dispatch session key is built, and whether an inbound Jira comment should
 * be relayed into that session. Kept dependency-free (no @/ imports) so
 * they're testable with plain `node --test` without needing to mock the
 * gateway/Jira/Slack clients that jira-dispatch.ts and the webhook route
 * depend on.
 *
 * See docs/superpowers/specs/2026-07-16-jira-dispatch-per-ticket-sessions-design.md.
 */

const BOT_COMMENT_MARKER = /^🤖/;

export function sessionKeyForTicket(agentSlug: string, issueKey: string): string {
  return `agent:${agentSlug}:${issueKey}`;
}

export interface CommentRelayDecision {
  relay: boolean;
  sessionKey?: string;
  message?: string;
}

export function decideCommentRelay(params: {
  issueKey: string;
  issueStatus: string;
  commentBody: string;
  agentSlug: string;
}): CommentRelayDecision {
  const { issueKey, issueStatus, commentBody, agentSlug } = params;

  if (!commentBody) return { relay: false };
  if (BOT_COMMENT_MARKER.test(commentBody)) return { relay: false };
  if (issueStatus === "To Do") return { relay: false };

  return {
    relay: true,
    sessionKey: sessionKeyForTicket(agentSlug, issueKey),
    message: `Roger replied on ${issueKey}: ${commentBody}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/roger/workspace/tenacitos && node --test src/lib/jira-agent-session.test.mjs`
Expected: PASS — 5/5 tests passing, no failures.

- [ ] **Step 5: Lint**

Run: `cd /Users/roger/workspace/tenacitos && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/roger/workspace/tenacitos
git add src/lib/jira-agent-session.ts src/lib/jira-agent-session.test.mjs
git commit -m "feat: add pure session-key and comment-relay-decision helpers"
```

---

### Task 2: Per-ticket session keys in dispatch

**Files:**
- Modify: `src/lib/jira-dispatch.ts:26-27,78-97`

**Interfaces:**
- Consumes: `sessionKeyForTicket` from `@/lib/jira-agent-session` (Task 1).
- Produces: `DEFAULT_AGENT` (currently private) becomes exported — Task 3 imports it directly
  rather than duplicating the `"sage"` string literal.

- [ ] **Step 1: Update the import and export `DEFAULT_AGENT`**

In `src/lib/jira-dispatch.ts`, add the new import alongside the existing ones (after the
`@/lib/jira` import block, before `@/lib/slack`):

```typescript
import { sessionKeyForTicket } from "@/lib/jira-agent-session";
```

Change line 27 from:

```typescript
const DEFAULT_AGENT = "sage";
```

to:

```typescript
export const DEFAULT_AGENT = "sage";
```

- [ ] **Step 2: Replace the hardcoded session key in `dispatchToAgent`**

Replace the `dispatchToAgent` function body (currently lines 78-97) with:

```typescript
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

(This removes the old comment about "Always targets Sage's own persistent session" and the old
`` `agent:${agentSlug}:main` `` line — everything else in the file, including
`AGENT_JIRA_ACCOUNT_ENV`, `jiraAccountIdForAgent`, and `runAutoDispatch`, is unchanged.)

- [ ] **Step 3: Verify with a dry run**

`runAutoDispatch`'s existing `dryRun` option doesn't exercise `dispatchToAgent` directly (it
short-circuits before calling it), so confirm the session-key wiring by reading the diff and
running the type checker, then a manual dry-run smoke test against the dev server:

```bash
cd /Users/roger/workspace/tenacitos
npx tsc --noEmit
```

Expected: no type errors.

```bash
npm run dev &
sleep 3
curl -s -X POST http://localhost:3140/api/jira/auto-dispatch \
  -H "Content-Type: application/json" \
  --cookie "mc_auth=$MC_AUTH_COOKIE" \
  -d '{"issueKey": "NEURALOPS-24", "dryRun": true}' | jq .
kill %1
```

Expected: JSON response with `dispatch.dryRun: true` and no errors (this confirms the route and
module still load and compile correctly end-to-end; the dry-run path doesn't call
`dispatchToAgent`, so it can't directly show the new session key — that's covered by Task 1's
unit tests plus this manual read-through of the diff). If `MC_AUTH_COOKIE` isn't available,
skip the curl call and rely on `tsc --noEmit` plus a manual code read of the diff against Task 1's
tested `sessionKeyForTicket` behavior.

- [ ] **Step 4: Lint and test**

Run: `cd /Users/roger/workspace/tenacitos && npm run lint && npm test`
Expected: lint clean, all tests passing (including Task 1's new tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/roger/workspace/tenacitos
git add src/lib/jira-dispatch.ts
git commit -m "fix: dispatch each Jira ticket to its own agent session"
```

---

### Task 3: Relay human comments into the ticket's session

**Files:**
- Modify: `src/app/api/jira/webhook/route.ts:25-29,114-136`

**Interfaces:**
- Consumes: `decideCommentRelay` from `@/lib/jira-agent-session` (Task 1), `DEFAULT_AGENT` from
  `@/lib/jira-dispatch` (Task 2), `callGateway` from `@/lib/gateway` (existing).

- [ ] **Step 1: Add imports**

In `src/app/api/jira/webhook/route.ts`, replace the import block (currently lines 25-29):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSingleIssue } from "@/lib/jira";
import { runAutoDispatch, DEFAULT_AGENT } from "@/lib/jira-dispatch";
import { decideCommentRelay } from "@/lib/jira-agent-session";
import { callGateway } from "@/lib/gateway";
import { sendSlackMessage } from "@/lib/slack";
import { createNotification } from "@/lib/notifications";
```

- [ ] **Step 2: Read the issue's status into the payload type**

The webhook payload already carries `issue.fields.status.name` for issue-related events
(`JiraWebhookPayload`, currently lines 56-78, is unchanged — `fields.status` is already
declared there). No type change needed.

- [ ] **Step 3: Add the human-reply relay branch**

In `src/app/api/jira/webhook/route.ts`, insert this new block immediately after the existing
`NEEDS_INPUT_MARKER` block's closing `}` (currently line 136, right before the
`// Only act on issue_created or status transitions into "To Do"` comment on line 138):

```typescript
  // Human-reply relay: any other human comment on a ticket that's already
  // being worked gets forwarded into that ticket's agent session, so an
  // answer to a blocking question (or any other reply) actually reaches the
  // agent instead of sitting silently on the ticket. This runs after the
  // NEEDS_INPUT_MARKER block above (which already returned), so an agent's
  // own outbound blocking question doesn't loop back into its own session.
  if (commentBody) {
    const decision = decideCommentRelay({
      issueKey,
      issueStatus: payload.issue?.fields?.status?.name ?? "",
      commentBody,
      agentSlug: DEFAULT_AGENT,
    });

    if (decision.relay && decision.sessionKey && decision.message) {
      await callGateway("sessions.send", {
        key: decision.sessionKey,
        message: decision.message,
        timeoutMs: 0,
      }).catch(() => null);
      return NextResponse.json({ ok: true, issueKey, event: "comment_relayed" });
    }

    return NextResponse.json({ skipped: true, reason: "comment not relayed" });
  }
```

- [ ] **Step 4: Verify with a manual webhook payload**

Start the dev server and POST a synthetic webhook payload matching what Jira sends for
`comment_created`, using the same `JIRA_WEBHOOK_SECRET` this route already validates against:

```bash
cd /Users/roger/workspace/tenacitos
npm run dev &
sleep 3
curl -s -X POST "http://localhost:3140/api/jira/webhook?secret=$JIRA_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookEvent": "comment_created",
    "issue": {
      "key": "NEURALOPS-23",
      "fields": { "status": { "name": "In Progress" } }
    },
    "comment": {
      "body": "test reply: use the neuralops-dev account",
      "author": { "displayName": "Roger Vasconcelos" }
    }
  }' | jq .
kill %1
```

Expected: `{"ok": true, "issueKey": "NEURALOPS-23", "event": "comment_relayed"}` if the gateway
is reachable, or the same response with the `callGateway` call swallowed by `.catch(() => null)`
if it isn't (e.g. the SSH tunnel issue noted in the design spec) — either way the route itself
must not 500. Also verify the bot-comment and To-Do filters with two more payloads: same body
but `"body": "🤖 Sent to sage for triage..."` should return
`{"skipped": true, "reason": "comment not relayed"}`, and same body but
`"status": {"name": "To Do"}` should also return `{"skipped": true, "reason": "comment not relayed"}`.

- [ ] **Step 5: Lint and test**

Run: `cd /Users/roger/workspace/tenacitos && npm run lint && npm test`
Expected: lint clean, all tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/roger/workspace/tenacitos
git add src/app/api/jira/webhook/route.ts
git commit -m "feat: relay human Jira comment replies into the ticket's agent session"
```
