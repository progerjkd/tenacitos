"use client";

import { useEffect, useState, useCallback } from "react";
import { Kanban, RefreshCw, ExternalLink, AlertCircle } from "lucide-react";
import { JIRA_COLUMNS, priorityIcon, type JiraIssue, type JiraStatus } from "@/lib/jira";

const COLUMN_COLORS: Record<JiraStatus, string> = {
  "To Do": "#6b7280",
  "In Progress": "#3b82f6",
  "Done": "#22c55e",
};

function IssueCard({
  issue,
  onStarted,
}: {
  issue: JiraIssue;
  onStarted: (key: string) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const isStartable = issue.status === "To Do";

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/jira/${issue.key}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitionName: "In Progress" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(`Error: ${data.error}`);
      } else {
        setFeedback("Started ✓");
        onStarted(issue.key);
      }
    } catch {
      setFeedback("Failed");
    } finally {
      setStarting(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  return (
    <div
      className="rounded-lg p-3 space-y-2 transition-all hover:scale-[1.01]"
      style={{
        backgroundColor: "var(--card-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          {issue.key}
        </a>
        <span className="text-xs flex-shrink-0">{priorityIcon(issue.priority)}</span>
      </div>

      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs leading-snug hover:underline"
        style={{ color: "var(--text-secondary)" }}
      >
        {issue.summary}
      </a>

      <div className="flex items-center justify-between gap-2">
        {issue.assignee && (
          <div className="flex items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={issue.assignee.avatarUrl}
              alt={issue.assignee.displayName}
              className="w-4 h-4 rounded-full"
            />
            <span
              className="text-xs truncate max-w-[80px]"
              style={{ color: "var(--text-muted)" }}
            >
              {issue.assignee.displayName}
            </span>
          </div>
        )}
        {feedback && (
          <span
            className="text-xs font-mono ml-auto"
            style={{ color: "var(--text-muted)" }}
          >
            {feedback}
          </span>
        )}
        {isStartable && !feedback && (
          <button
            onClick={handleStart}
            disabled={starting}
            className="ml-auto text-xs px-2 py-0.5 rounded transition-all"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              backgroundColor: "transparent",
              cursor: starting ? "wait" : "pointer",
            }}
          >
            {starting ? "…" : "▶ Start"}
          </button>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  issues,
  onStarted,
}: {
  status: JiraStatus;
  issues: JiraIssue[];
  onStarted: (key: string) => void;
}) {
  const color = COLUMN_COLORS[status];
  return (
    <div className="flex-1 min-w-[220px] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <h2
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {status}
          </h2>
        </div>
        <span
          className="font-mono text-xs px-2 py-0.5 rounded"
          style={{
            backgroundColor: "var(--card-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          {issues.length}
        </span>
      </div>
      <div className="space-y-2">
        {issues.length === 0 && (
          <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
            —
          </p>
        )}
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} onStarted={onStarted} />
        ))}
      </div>
    </div>
  );
}

export default function JiraPage() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchIssues = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/jira/issues");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setIssues(data.issues ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIssues();
    const interval = setInterval(fetchIssues, 60_000);
    return () => clearInterval(interval);
  }, [fetchIssues]);

  const handleStarted = (key: string) => {
    setIssues((prev) =>
      prev.map((i) => (i.key === key ? { ...i, status: "In Progress" } : i)),
    );
  };

  const byStatus = Object.fromEntries(
    JIRA_COLUMNS.map((col) => [col, issues.filter((i) => i.status === col)]),
  ) as Record<JiraStatus, JiraIssue[]>;

  const openCount = issues.filter((i) => i.status !== "Done").length;

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-3xl font-bold mb-1"
            style={{
              fontFamily: "var(--font-heading)",
              color: "var(--text-primary)",
              letterSpacing: "-1.5px",
            }}
          >
            <Kanban className="inline-block w-8 h-8 mr-2 mb-1" />
            NEURALOPS Board
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            {openCount} open issues
            {lastUpdated && (
              <span style={{ color: "var(--text-muted)", marginLeft: "8px" }}>
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${process.env.NEXT_PUBLIC_JIRA_BASE_URL ?? "https://neuralops.atlassian.net"}/jira/software/projects/NEURALOPS/boards`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Jira
          </a>
          <button
            onClick={() => { setLoading(true); fetchIssues(); }}
            className="flex items-center gap-2"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "var(--card)",
              color: "var(--text-primary)",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-4 flex items-center gap-3 p-4 rounded-xl"
          style={{
            backgroundColor: "color-mix(in srgb, var(--negative) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--negative) 30%, transparent)",
          }}
        >
          <AlertCircle className="w-5 h-5" style={{ color: "var(--negative)" }} />
          <span style={{ color: "var(--negative)" }}>{error}</span>
        </div>
      )}

      {/* Board */}
      {loading && issues.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div
            style={{
              width: "2rem",
              height: "2rem",
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <style jsx global>{`
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {JIRA_COLUMNS.map((col) => (
            <KanbanColumn
              key={col}
              status={col}
              issues={byStatus[col] ?? []}
              onStarted={handleStarted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
