export const JIRA_COLUMNS = ["To Do", "In Progress", "Done"] as const;
export type JiraStatus = (typeof JIRA_COLUMNS)[number];

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
  priority: string;
  issuetype: string;
  assignee: { displayName: string; avatarUrl: string } | null;
  url: string;
}

function jiraAuthHeader(): string {
  const creds = `${process.env.JIRA_USER ?? ""}:${process.env.JIRA_API_TOKEN ?? ""}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

function jiraBase(): string {
  return (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
}

export async function getProjectIssues(project: string): Promise<JiraIssue[]> {
  const jql = `project = ${project} ORDER BY updated DESC`;

  const res = await fetch(`${jiraBase()}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: jiraAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jql,
      maxResults: 100,
      fields: ["summary", "status", "priority", "assignee", "issuetype"],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira fetch failed: ${res.status} — ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    issues: Array<{
      id: string;
      key: string;
      fields: {
        summary: string;
        status: { name: string };
        priority: { name: string };
        issuetype: { name: string };
        assignee: {
          displayName: string;
          avatarUrls: { "24x24": string };
        } | null;
      };
    }>;
  };

  return data.issues.map((issue) => ({
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    priority: issue.fields.priority?.name ?? "Medium",
    issuetype: issue.fields.issuetype?.name ?? "Task",
    assignee: issue.fields.assignee
      ? {
          displayName: issue.fields.assignee.displayName,
          avatarUrl: issue.fields.assignee.avatarUrls["24x24"],
        }
      : null,
    url: `${jiraBase()}/browse/${issue.key}`,
  }));
}

export async function transitionIssue(
  issueKey: string,
  transitionId: string,
): Promise<void> {
  const res = await fetch(`${jiraBase()}/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    headers: {
      Authorization: jiraAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transition: { id: transitionId } }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jira transition failed: ${res.status}`);
  }
}

export async function getTransitions(
  issueKey: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${jiraBase()}/rest/api/3/issue/${issueKey}/transitions`, {
    headers: {
      Authorization: jiraAuthHeader(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { transitions: Array<{ id: string; name: string }> };
  return data.transitions;
}

export function priorityColor(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "highest" || p === "blocker") return "#ef4444";
  if (p === "high") return "#f97316";
  if (p === "medium") return "#eab308";
  if (p === "low") return "#3b82f6";
  return "#6b7280";
}

export function priorityIcon(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "highest" || p === "blocker") return "🔴";
  if (p === "high") return "🟠";
  if (p === "medium") return "🟡";
  if (p === "low") return "🔵";
  return "⚪";
}

export function jiraBoardUrl(project: string): string {
  return `${jiraBase()}/jira/software/projects/${project}/boards/1`;
}

export async function getSingleIssue(issueKey: string): Promise<JiraIssue | null> {
  const res = await fetch(
    `${jiraBase()}/rest/api/3/issue/${issueKey}?fields=summary,status,priority,assignee,issuetype`,
    {
      headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  const issue = (await res.json()) as {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      priority: { name: string };
      issuetype: { name: string };
      assignee: { displayName: string; avatarUrls: { "24x24": string } } | null;
    };
  };
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    priority: issue.fields.priority?.name ?? "Medium",
    issuetype: issue.fields.issuetype?.name ?? "Task",
    assignee: issue.fields.assignee
      ? {
          displayName: issue.fields.assignee.displayName,
          avatarUrl: issue.fields.assignee.avatarUrls["24x24"],
        }
      : null,
    url: `${jiraBase()}/browse/${issue.key}`,
  };
}

export async function assignIssue(issueKey: string, accountId: string): Promise<void> {
  const res = await fetch(`${jiraBase()}/rest/api/3/issue/${issueKey}/assignee`, {
    method: "PUT",
    headers: {
      Authorization: jiraAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountId }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jira assign failed: ${res.status}`);
  }
}

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
