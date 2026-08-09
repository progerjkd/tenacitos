// Pure, dependency-free Basic-auth header builder for Jira/Confluence Cloud REST calls. Kept
// separate from jira.ts (which has @/-aliased imports and so can't use this codebase's plain
// transpile-and-import test convention directly) so the actual auth logic is unit-testable —
// same reasoning as jira-agent-session.ts existing for jira-dispatch.ts's benefit.
export function buildJiraAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}
