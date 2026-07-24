# Jira service accounts for openclaw agents

Auto-dispatched tickets get assigned to the agent working them (Sage, Max, Iris, Quinn,
Echo, Vale, Pixel) instead of staying unassigned. This requires one dedicated Atlassian
account per agent — Jira has no concept of a non-human assignee on a Free plan (that's
gated behind Rovo, which needs Standard/Premium/Enterprise).

## 1. Check your seat headroom

Jira Free caps sites at 10 total users. Count existing humans on the site, then confirm
`10 - <humans> >= 7` before creating all seven. If it doesn't fit, create accounts only
for the agents you actually dispatch to (`sage` is the default and the one that matters
most) and leave the rest of the env vars blank.

## 2. Create each account

For each agent, in **Jira admin → Directory → Add people**:

1. Invite an email alias you control, e.g. `roger+sage@gmail.com`, `roger+max@gmail.com`
   (Gmail `+` aliases all land in your normal inbox — no new mailboxes needed).
2. Open the invite email and accept it (log in once) to activate the account — Atlassian
   won't create a usable account without this step.
3. Set the account's display name and avatar to match the agent (see
   `src/lib/agents-config.ts` for names/emojis: Max 🧠, Iris 📥, Quinn 📅, Echo ✍️, Vale 🔍,
   Pixel 🎮 — Sage doesn't have an `agents-config.ts` entry since it's the gateway-level
   coordinator, not a dashboard agent).
4. Add the account to the `NEURALOPS` project with a basic contributor role (no admin).

## 3. Look up each account's `accountId`

```bash
curl -u "$JIRA_USER:$JIRA_API_TOKEN" \
  "$JIRA_BASE_URL/rest/api/3/user/search?query=roger+sage@gmail.com"
```

The response's `accountId` field is what goes in `.env`:

```
JIRA_ACCOUNT_ID_SAGE=<accountId>
```

Repeat for whichever agents you created accounts for. Leave any others blank —
`jira-dispatch.ts` skips assignment for an agent slug with no configured account ID.

## 4. Verify

Trigger a manual dispatch (`POST /api/jira/auto-dispatch` with a real `issueKey`) and
confirm the issue's assignee in Jira switches to the agent's account. The 3D office's
`JiraHoloBoard` and the `/jira` dashboard page both already render `issue.assignee` from
the Jira API, so the agent's avatar shows up there automatically — no UI changes needed.
