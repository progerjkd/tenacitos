'use client';

import type { OfficeAgent } from './useOfficeData';
import { ACTIVITY_VISUALS, agentActivity } from './layout';

function formatLastActivity(iso?: string): string {
  if (!iso) return 'no recent activity';
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface AgentInfoPanelProps {
  agent: OfficeAgent;
  onClose: () => void;
}

/** HTML overlay with the real data behind a selected agent pod. */
export default function AgentInfoPanel({ agent, onClose }: AgentInfoPanelProps) {
  const activity = agentActivity(agent);
  const visual = ACTIVITY_VISUALS[activity];

  return (
    <div className="absolute top-4 right-4 bottom-4 w-80 z-40 rounded-2xl border border-cyan-500/30 bg-slate-950/80 backdrop-blur-md text-slate-100 p-5 flex flex-col gap-4 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-4xl" style={{ filter: `drop-shadow(0 0 8px ${agent.color})` }}>
            {agent.emoji}
          </span>
          <div>
            <h2 className="text-xl font-bold" style={{ color: agent.color }}>
              {agent.name}
            </h2>
            <p className="text-xs text-slate-400 font-mono">{agent.id}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-2xl leading-none"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div
        className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full text-xs font-semibold tracking-widest"
        style={{ color: visual.indicator, border: `1px solid ${visual.indicator}55` }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: visual.indicator,
            boxShadow: activity !== 'offline' ? `0 0 6px ${visual.indicator}` : undefined,
          }}
        />
        {visual.label}
      </div>

      <dl className="space-y-3 text-sm">
        {agent.role && (
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Role</dt>
            <dd className="text-right">{agent.role}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-slate-400">Model</dt>
          <dd className="font-mono text-cyan-300 text-right break-all">{agent.model}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-400">Active sessions</dt>
          <dd className="text-right">{agent.activeSessions}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-400">Last activity</dt>
          <dd className="text-right">{formatLastActivity(agent.lastActivity)}</dd>
        </div>
      </dl>

      {agent.currentTask && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
          <p className="text-xs text-slate-400 mb-1 tracking-widest">CURRENT TASK</p>
          <p className="text-sm text-cyan-100">{agent.currentTask}</p>
        </div>
      )}

      <a
        href="/agents"
        className="mt-auto text-center text-sm font-semibold py-2.5 rounded-lg border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 transition-colors"
      >
        Open Agent Dashboard →
      </a>
    </div>
  );
}
