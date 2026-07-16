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
