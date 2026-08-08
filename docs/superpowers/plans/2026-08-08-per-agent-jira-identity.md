# Per-Agent Jira Identity (comments-as-the-agent) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each OpenClaw agent's Jira comments — both tenacitos's own bookkeeping and the
agent's own free-form writeup — post under that agent's real Atlassian identity instead of
Roger's, wired to activate automatically as each agent's account is set up.

**Architecture:** Two independent wiring points, both gated behind a per-agent Atlassian API
token that only exists once Roger personally activates that agent's account and mints a token
(no admin-side shortcut exists for this). Part A is tenacitos application code (an optional
credentials override threaded through `addJiraComment`). Part B is a repeatable script that
edits the OpenClaw gateway's hand-maintained `openclaw.json` to give one agent its own
`mcp-atlassian` server instance instead of sharing Roger's.

**Tech Stack:** TypeScript, Next.js, `node --test` (tenacitos); bash + `jq` (openclaw-terraform).

## Global Constraints

- No behavior change for any agent without a configured token — every fallback path must
  produce byte-identical output to what exists today (Roger's shared credential/server).
- `jira.ts` has `@/`-aliased imports and cannot use this codebase's plain transpile-and-import
  test convention directly — the auth-header logic must be extracted into a new, dependency-free
  file so it's unit-testable, matching how `jira-agent-session.ts` already solves this same
  problem for `jira-dispatch.ts`.
- Agent emails are literal constants: `<agentSlug>@neuralops.ca` — no lookup needed.
- `openclaw.json` on the gateway box is deliberately hand-maintained, not Terraform-templated
  (`user-data.sh` seeds only a minimal skeleton on first boot and never touches it again). Any
  script that edits it must edit the live file directly over SSH, not go through Terraform.
- Part B cannot be verified end-to-end today — no agent has an activated account with a minted
  token yet (see design doc, `docs/superpowers/specs/2026-08-08-per-agent-jira-identity-design.md`
  in `openclaw-terraform`). Its task's deliverable is a script whose JSON-transformation logic is
  verified with a placeholder token, plus a concrete runbook to run for real once Sage's token
  exists — not a claim that Sage is actually wired by the time this plan is "done."

---

### Task 1: Per-agent Jira comment credentials (tenacitos)

**Files:**
- Create: `src/lib/jira-auth.ts`
- Create: `src/lib/jira-auth.test.mjs`
- Modify: `src/lib/jira.ts:17-19` (`jiraAuthHeader`), `:285-303` (`addJiraComment`)
- Modify: `src/lib/jira-dispatch.ts:29-46` (new token map), `:322-326` (comment call site)

**Interfaces:**
- Produces: `buildJiraAuthHeader(email: string, token: string): string`, exported from
  `@/lib/jira-auth`.
- Produces: `addJiraComment(issueKey: string, body: string, credentials?: { email: string; token: string }): Promise<void>`
  — new optional third parameter, exported from `@/lib/jira`.
- Consumes (unchanged, already exist): `AGENT_JIRA_ACCOUNT_ENV` pattern and
  `jiraAccountIdForAgent()` in `jira-dispatch.ts` — this task adds a parallel map alongside it,
  not a replacement.

- [ ] **Step 1: Write the failing test for `buildJiraAuthHeader`**

Create `src/lib/jira-auth.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let moduleId = 0;

async function loadModule() {
  const source = readFileSync(path.join(__dirname, "jira-auth.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${moduleId++}`
  );
}

test("buildJiraAuthHeader base64-encodes email:token as Basic auth", async () => {
  const { buildJiraAuthHeader } = await loadModule();
  const expected = `Basic ${Buffer.from("sage@neuralops.ca:tok_abc123").toString("base64")}`;
  assert.equal(buildJiraAuthHeader("sage@neuralops.ca", "tok_abc123"), expected);
});

test("buildJiraAuthHeader produces different headers for different credentials", async () => {
  const { buildJiraAuthHeader } = await loadModule();
  const sage = buildJiraAuthHeader("sage@neuralops.ca", "tok_sage");
  const roger = buildJiraAuthHeader("roger@neuralops.ca", "tok_roger");
  assert.notEqual(sage, roger);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/workspace/tenacitos && node --test src/lib/jira-auth.test.mjs`
Expected: FAIL — `jira-auth.ts` doesn't exist yet, so the dynamic `import()` rejects.

- [ ] **Step 3: Implement `buildJiraAuthHeader`**

Create `src/lib/jira-auth.ts`:

```ts
// Pure, dependency-free Basic-auth header builder for Jira/Confluence Cloud REST calls. Kept
// separate from jira.ts (which has @/-aliased imports and so can't use this codebase's plain
// transpile-and-import test convention directly) so the actual auth logic is unit-testable —
// same reasoning as jira-agent-session.ts existing for jira-dispatch.ts's benefit.
export function buildJiraAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/workspace/tenacitos && node --test src/lib/jira-auth.test.mjs`
Expected: both tests PASS.

- [ ] **Step 5: Wire `jira.ts` to accept optional per-call credentials**

In `src/lib/jira.ts`, add the import (near the top, alongside the existing `adf` import):

```ts
import { extractPlainText } from "@/lib/adf";
import { buildJiraAuthHeader } from "@/lib/jira-auth";
```

Replace the existing `jiraAuthHeader` function (currently lines 17–19):

```ts
function jiraAuthHeader(): string {
  const creds = `${process.env.JIRA_USER ?? ""}:${process.env.JIRA_API_TOKEN ?? ""}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}
```

with:

```ts
function jiraAuthHeader(credentials?: { email: string; token: string }): string {
  const email = credentials?.email ?? process.env.JIRA_USER ?? "";
  const token = credentials?.token ?? process.env.JIRA_API_TOKEN ?? "";
  return buildJiraAuthHeader(email, token);
}
```

Every other call site in this file (`getProjectIssues`, `getTransitions`, etc.) calls
`jiraAuthHeader()` with no arguments — leave every one of those unchanged; the new parameter is
optional and defaults to today's global-credential behavior.

Then replace `addJiraComment` (currently lines 285–303):

```ts
export async function addJiraComment(issueKey: string, body: string): Promise<void> {
  const res = await fetch(`${jiraBase()}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: jiraAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jira comment failed: ${res.status}`);
  }
}
```

with:

```ts
export async function addJiraComment(
  issueKey: string,
  body: string,
  credentials?: { email: string; token: string },
): Promise<void> {
  const res = await fetch(`${jiraBase()}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: jiraAuthHeader(credentials),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jira comment failed: ${res.status}`);
  }
}
```

- [ ] **Step 6: Add the per-agent token map and resolver in `jira-dispatch.ts`**

In `src/lib/jira-dispatch.ts`, immediately after the existing `AGENT_JIRA_ACCOUNT_ENV` block and
its `jiraAccountIdForAgent` function (currently lines 37–50), add:

```ts
// Parallel to AGENT_JIRA_ACCOUNT_ENV above, but for the API token needed to post a comment AS
// that agent's own account, rather than just assigning tickets to it. Each agent's email is a
// literal constant (matches its Atlassian account) — no lookup needed, unlike accountId.
const AGENT_JIRA_TOKEN_ENV: Record<string, string> = {
  sage: "JIRA_API_TOKEN_SAGE",
  main: "JIRA_API_TOKEN_MAIN",
  inbox: "JIRA_API_TOKEN_INBOX",
  brief: "JIRA_API_TOKEN_BRIEF",
  ghostwriter: "JIRA_API_TOKEN_GHOSTWRITER",
  qa: "JIRA_API_TOKEN_QA",
  playsmith: "JIRA_API_TOKEN_PLAYSMITH",
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
  return { email: `${agentSlug}@neuralops.ca`, token };
}
```

- [ ] **Step 7: Pass the agent's credentials at the comment call site**

In `runAutoDispatch` (same file), find step 5's comment post (currently around lines 322–326):

```ts
        // 5. Post comment on Jira issue
        await addJiraComment(
          issue.key,
          `🤖 Sent to ${agentSlug} for triage and assignment.\n${buildDispatchMarker(stintStart)}`,
        ).catch(() => null);
```

Change it to:

```ts
        // 5. Post comment on Jira issue — as the agent's own account once it has a token
        // configured (see jiraCommentCredentialsForAgent above), Roger's shared credential
        // otherwise.
        await addJiraComment(
          issue.key,
          `🤖 Sent to ${agentSlug} for triage and assignment.\n${buildDispatchMarker(stintStart)}`,
          jiraCommentCredentialsForAgent(agentSlug),
        ).catch(() => null);
```

- [ ] **Step 8: Run the full test suite, typecheck, and lint**

Run: `cd ~/workspace/tenacitos && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS. Test count should be 27 (existing) + 2 new `jira-auth.test.mjs` tests = 29.

- [ ] **Step 9: Commit**

```bash
cd ~/workspace/tenacitos
git add src/lib/jira-auth.ts src/lib/jira-auth.test.mjs src/lib/jira.ts src/lib/jira-dispatch.ts
git commit -m "$(cat <<'EOF'
feat: let addJiraComment post as a per-agent Jira identity

Extends the existing per-agent-account pattern (already used for
ticket assignment) to comment authorship. Falls back to Roger's
shared credential when an agent has no token configured yet — no
behavior change until JIRA_API_TOKEN_<AGENT> is actually set.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Push, open a PR, and follow the standing Codex-review workflow (wait for review or clean
reaction, address findings, resolve threads) before merging.

---

### Task 2: Per-agent OpenClaw MCP wiring script (openclaw-terraform)

**Files:**
- Create: `add-agent-jira-identity.sh` (repo root, alongside `start.sh`/`stop.sh`/`setup-mission-control.sh`)

**Interfaces:**
- Consumes: nothing from Task 1 — independent of the tenacitos code change, operates entirely on
  the gateway box's `openclaw.json`.
- Produces: a repeatable, idempotent script: `./add-agent-jira-identity.sh <agent-slug> <api-token>`

This script cannot be verified against a real agent today — no account has a minted token yet
(see Global Constraints). Its own correctness (the JSON it produces) is verified with a
placeholder token value; wiring an actual agent for real is a separate, later manual run once
Roger has completed that agent's account setup.

- [ ] **Step 1: Write the script**

Create `add-agent-jira-identity.sh`:

```bash
#!/usr/bin/env bash
# Give one OpenClaw agent its own mcp-atlassian server instance, authenticated as that agent's
# own Atlassian account, instead of sharing Roger's. See:
#   docs/superpowers/specs/2026-08-08-per-agent-jira-identity-design.md
#
# Requires the agent's Atlassian account to already be Active (invite accepted) and an API
# token already minted for it (id.atlassian.com -> Security -> API tokens) -- neither of those
# steps can be done by this script; they're a one-time login-gated action per account.
#
# Usage: ./add-agent-jira-identity.sh <agent-slug> <api-token>
# Example: ./add-agent-jira-identity.sh sage 'ATATT3xFfGF0...'
set -euo pipefail

SSH_HOST="openclaw.neuralops.ca"
CONFIG_PATH="/home/node/.openclaw/openclaw.json"
GATEWAY_CONTAINER="openclaw-openclaw-gateway-1"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <agent-slug> <api-token>" >&2
  exit 1
fi

AGENT_SLUG="$1"
API_TOKEN="$2"
AGENT_EMAIL="${AGENT_SLUG}@neuralops.ca"  # see note below — this line was wrong, fixed in review
SERVER_NAME="atlassian-${AGENT_SLUG}"

if ! ssh -o ConnectTimeout=10 -o BatchMode=yes ubuntu@"$SSH_HOST" true 2>/dev/null; then
  echo "ERROR: Cannot SSH to $SSH_HOST — is the instance running?" >&2
  exit 1
fi

echo "Wiring Jira identity for agent '$AGENT_SLUG' ($AGENT_EMAIL)..."

# Build the new server block + tool-scoping update as a jq filter, run locally (jq is already a
# dependency of this repo's other scripts — see status.sh), and write the result back only if
# it's valid JSON that still parses (set -e plus jq's own exit code on malformed input protects
# against writing a broken config).
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required (brew install jq)." >&2
  exit 1
fi

ssh ubuntu@"$SSH_HOST" \
  "docker exec -i $GATEWAY_CONTAINER sh -c 'cat $CONFIG_PATH'" \
  | jq \
      --arg agent "$AGENT_SLUG" \
      --arg server "$SERVER_NAME" \
      --arg email "$AGENT_EMAIL" \
      --arg token "$API_TOKEN" \
      '
      .mcp.servers[$server] = {
        command: "/opt/openclaw-data/tools/uv/uvx",
        args: ["mcp-atlassian"],
        env: {
          JIRA_URL: "https://neuralops.atlassian.net",
          JIRA_USERNAME: $email,
          JIRA_API_TOKEN: $token,
          CONFLUENCE_URL: "https://neuralops.atlassian.net",
          CONFLUENCE_USERNAME: $email,
          CONFLUENCE_API_TOKEN: $token,
          UV_CACHE_DIR: "/opt/openclaw-data/uv-cache"
        }
      }
      |
      (.agents.list[] | select(.id == $agent)) |= (
        .tools = ((.tools // {}) + {
          deny: (((.tools.deny // []) - ["atlassian"]) + ["atlassian"]),
          allow: (((.tools.allow // []) - [$server]) + [$server])
        })
      )
      ' \
  > /tmp/openclaw-updated-"$AGENT_SLUG".json

if ! jq empty /tmp/openclaw-updated-"$AGENT_SLUG".json 2>/dev/null; then
  echo "ERROR: generated config is not valid JSON — aborting, nothing was written." >&2
  exit 1
fi

echo "Generated config for review: /tmp/openclaw-updated-$AGENT_SLUG.json"
echo "Diff vs. live config:"
ssh ubuntu@"$SSH_HOST" "docker exec -i $GATEWAY_CONTAINER sh -c 'cat $CONFIG_PATH'" \
  | diff -u - /tmp/openclaw-updated-"$AGENT_SLUG".json || true

read -rp "Apply this change and restart the gateway? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ]; then
  echo "Aborted — no changes applied."
  exit 0
fi

scp /tmp/openclaw-updated-"$AGENT_SLUG".json ubuntu@"$SSH_HOST":/tmp/openclaw-new.json
ssh ubuntu@"$SSH_HOST" "docker cp /tmp/openclaw-new.json $GATEWAY_CONTAINER:$CONFIG_PATH && rm /tmp/openclaw-new.json"
ssh ubuntu@"$SSH_HOST" "docker restart $GATEWAY_CONTAINER"

echo "Done. Verify: trigger a dispatch to '$AGENT_SLUG' and confirm its next Jira comment shows"
echo "$AGENT_EMAIL as the author, not roger@neuralops.ca."
```

Make it executable:

```bash
chmod +x add-agent-jira-identity.sh
```

**Note (added after implementation and review):** the code block above is the plan's original,
as-written version — kept for the TDD/implementation narrative. The actual shipped script diverged
from it across two review rounds and is meaningfully more robust: the `AGENT_EMAIL` line above is
wrong (it was templated from the agent's slug; the real script maps slug → confirmed real Atlassian
account email, e.g. `main` → `max@neuralops.ca`, not `main@neuralops.ca`), `tools.allow` is never
touched (only `tools.deny`, since `tools.allow` is a genuinely restrictive layer — confirmed against
the live gateway's own source), tokens are redacted before being printed and cleaned up on exit, the
config is written to the host path with correct ownership rather than via `docker cp`, and the SSH
probe falls back to the public IP + `alternate_ssh_port` when Tailscale is unreachable (matching
`setup-claude-cli.sh`'s established pattern). Treat `add-agent-jira-identity.sh` itself as the
source of truth, not this snapshot.

- [ ] **Step 2: Verify the JSON transformation with a placeholder token**

This is the one thing verifiable today without a real account. Run against a real *copy* of the
live config (never point this at the live box for this step):

```bash
ssh ubuntu@openclaw.neuralops.ca "docker exec -i openclaw-openclaw-gateway-1 sh -c 'cat /home/node/.openclaw/openclaw.json'" > /tmp/openclaw-live-snapshot.json

# Run the same jq filter the script uses, by hand, against the snapshot:
cat /tmp/openclaw-live-snapshot.json | jq \
  --arg agent "sage" --arg server "atlassian-sage" \
  --arg email "sage@neuralops.ca" --arg token "PLACEHOLDER_NOT_A_REAL_TOKEN" \
  '
  .mcp.servers[$server] = {
    command: "/opt/openclaw-data/tools/uv/uvx", args: ["mcp-atlassian"],
    env: { JIRA_URL: "https://neuralops.atlassian.net", JIRA_USERNAME: $email,
           JIRA_API_TOKEN: $token, CONFLUENCE_URL: "https://neuralops.atlassian.net",
           CONFLUENCE_USERNAME: $email, CONFLUENCE_API_TOKEN: $token,
           UV_CACHE_DIR: "/opt/openclaw-data/uv-cache" }
  }
  |
  (.agents.list[] | select(.id == $agent)) |= (
    .tools = ((.tools // {}) + {
      deny: (((.tools.deny // []) - ["atlassian"]) + ["atlassian"]),
      allow: (((.tools.allow // []) - ["atlassian-sage"]) + ["atlassian-sage"])
    })
  )
  ' | jq empty && echo "VALID JSON — transformation is sound"
```

Expected: `VALID JSON — transformation is sound`, and manually eyeballing the output shows
`mcp.servers["atlassian-sage"]` with the placeholder token, and the `sage` entry in `agents.list`
gaining a `tools.allow: ["atlassian-sage"]` / `tools.deny: ["atlassian"]` pair, with every other
agent entry unchanged.

- [ ] **Step 3: Commit**

```bash
git add add-agent-jira-identity.sh
git commit -m "$(cat <<'EOF'
feat: add script to wire an agent's own Jira identity into OpenClaw

Gives one agent its own mcp-atlassian MCP server instance (its own
Atlassian API token) instead of sharing Roger's, plus the tool-scoping
so that agent actually uses it. Requires the agent's Atlassian account
to already be Active with a minted token -- a one-time, login-gated,
per-account manual step this script can't do on its own.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Push, open a PR, and follow the standing Codex-review workflow before merging.

- [ ] **Step 4: Live runbook, once Sage's account has a real token (not part of "done" for this plan)**

Record this as the next action for Roger, not something to execute automatically:

1. Roger accepts Sage's pending Jira invite (moves `Invited` → `Active`).
2. Roger logs into the `sage@neuralops.ca` account at `id.atlassian.com` → Security → API
   tokens → creates a token.
3. Run `./add-agent-jira-identity.sh sage '<real token>'` — review the printed diff, confirm `y`.
4. Also set `JIRA_API_TOKEN_SAGE` in `tenacitos`'s `.env.tenacitos` on the box to the same token
   (Task 1's fallback needs it independently — restart the `tenacitos` container after).
5. Trigger a real dispatch and confirm **both**: the marker comment ("🤖 Sent to sage...") and
   Sage's own free-form triage comment both show `sage@neuralops.ca` as author in Jira, not
   Roger's. If the agent's own comment still shows Roger, that's the open per-agent MCP
   tool-resolution question flagged in the design doc — investigate whether OpenClaw's
   `tools.allow`/`deny` actually disambiguates two servers exposing identically-named tools
   before assuming the wiring itself is wrong.
