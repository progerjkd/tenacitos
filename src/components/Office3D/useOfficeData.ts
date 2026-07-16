'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JiraIssue } from '@/lib/jira';

/**
 * Agent as rendered in the office. Identity fields come from /api/agents
 * (the same source the /agents page uses), live task info from /api/office.
 */
export interface OfficeAgent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  status: 'online' | 'offline';
  activeSessions: number;
  lastActivity?: string;
  role?: string;
  currentTask?: string;
  isActive?: boolean;
}

export interface OfficeData {
  agents: OfficeAgent[];
  issues: JiraIssue[];
  loadingAgents: boolean;
  agentsError: boolean;
  jiraError: boolean;
}

interface AgentsResponse {
  agents?: Array<Omit<OfficeAgent, 'role' | 'currentTask' | 'isActive'>>;
}

interface OfficeStatusResponse {
  agents?: Array<{ id: string; role?: string; currentTask?: string; isActive?: boolean }>;
}

const AGENTS_POLL_MS = 30_000;
const JIRA_POLL_MS = 60_000;

/**
 * Polls the office data feeds. Every fetch is best-effort: on failure the
 * last good data is kept and the matching error flag is raised so the HUD
 * can show an "offline feed" badge instead of breaking the scene.
 */
export function useOfficeData(): OfficeData {
  const [agents, setAgents] = useState<OfficeAgent[]>([]);
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState(false);
  const [jiraError, setJiraError] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const [agentsRes, officeRes] = await Promise.all([
        fetch('/api/agents'),
        // Task feed is optional — identity must never depend on it
        fetch('/api/office').catch(() => null),
      ]);
      if (!agentsRes.ok) throw new Error(`HTTP ${agentsRes.status}`);
      const agentsData = (await agentsRes.json()) as AgentsResponse;

      let statusById: Map<string, { role?: string; currentTask?: string; isActive?: boolean }> =
        new Map();
      if (officeRes?.ok) {
        const officeData = (await officeRes.json()) as OfficeStatusResponse;
        statusById = new Map((officeData.agents ?? []).map((a) => [a.id, a]));
      }

      setAgents(
        (agentsData.agents ?? []).map((agent) => ({
          ...agent,
          ...statusById.get(agent.id),
        })),
      );
      setAgentsError(false);
    } catch {
      setAgentsError(true);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const fetchIssues = useCallback(async () => {
    try {
      const res = await fetch('/api/jira/issues');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { issues?: JiraIssue[] };
      setIssues(data.issues ?? []);
      setJiraError(false);
    } catch {
      setJiraError(true);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, AGENTS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  useEffect(() => {
    fetchIssues();
    const interval = setInterval(fetchIssues, JIRA_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchIssues]);

  return { agents, issues, loadingAgents, agentsError, jiraError };
}
