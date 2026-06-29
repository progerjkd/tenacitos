import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { callGateway, GatewayError, type CronListResult } from "@/lib/gateway";
import { AGENT_DEFS } from "@/lib/agents-config";

export const dynamic = "force-dynamic";

interface Agent {
  id: string;
  name?: string;
  emoji: string;
  color: string;
  model: string;
  workspace: string;
  dmPolicy?: string;
  allowAgents?: string[];
  allowAgentsDetails?: Array<{
    id: string;
    name: string;
    emoji: string;
    color: string;
  }>;
  botToken?: string;
  status: "online" | "offline";
  lastActivity?: string;
  activeSessions: number;
}

interface RawAgent {
  id: string;
  name?: string;
  workspace: string;
  model?: { primary?: string };
  subagents?: { allowAgents?: string[] };
  ui?: { emoji?: string; color?: string };
}

function getAgentDisplayInfo(
  agentId: string,
  agentConfig: RawAgent | null,
): { emoji: string; color: string; name: string } {
  const def = AGENT_DEFS.find((a) => a.slug === agentId);
  return {
    emoji: agentConfig?.ui?.emoji ?? def?.emoji ?? "🤖",
    color: agentConfig?.ui?.color ?? def?.color ?? "#666666",
    name: agentConfig?.name ?? def?.name ?? agentId,
  };
}

export async function GET() {
  try {
    const configPath =
      (process.env.OPENCLAW_DIR || "/root/.openclaw") + "/openclaw.json";
    const rawConfig = (() => {
      try {
        return JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        return null;
      }
    })();
    if (!rawConfig) return NextResponse.json({ agents: [] });
    const config = rawConfig;

    // Fetch live cron state from gateway (best-effort; graceful if gateway is down)
    let cronJobs: CronListResult["jobs"] = [];
    try {
      const result = await callGateway<CronListResult>("cron.list", {});
      cronJobs = result.jobs ?? [];
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      // Gateway unavailable — agents will show as offline with no last-activity
    }

    const agents: Agent[] = config.agents.list.map((agent: RawAgent) => {
      const agentInfo = getAgentDisplayInfo(agent.id, agent);
      const def = AGENT_DEFS.find((a) => a.slug === agent.id);

      const telegramAccount = config.channels?.telegram?.accounts?.[agent.id];
      const botToken = telegramAccount?.botToken;

      // Find cron jobs belonging to this agent
      const agentCrons = cronJobs.filter(
        (j) =>
          j.agentId === agent.id ||
          (def?.cronNames ?? []).includes(j.name),
      );

      // Determine last activity from most recent cron run
      let lastActivity: string | undefined;
      let activeSessions = 0;
      const now = Date.now();

      for (const cron of agentCrons) {
        if (cron.state.runningAtMs) {
          activeSessions++;
        }
        const ran = cron.state.lastRunAtMs;
        if (ran) {
          const iso = new Date(ran).toISOString();
          if (!lastActivity || ran > new Date(lastActivity).getTime()) {
            lastActivity = iso;
          }
        }
      }

      // Online = currently running a cron, or ran one in the last 5 minutes
      const recentRunMs = lastActivity
        ? now - new Date(lastActivity).getTime()
        : Infinity;
      const status: "online" | "offline" =
        activeSessions > 0 || recentRunMs < 5 * 60 * 1000 ? "online" : "offline";

      const allowAgents = agent.subagents?.allowAgents ?? [];
      const allowAgentsDetails = allowAgents.map((subagentId: string) => {
        const subagentConfig = config.agents.list.find(
          (a: RawAgent) => a.id === subagentId,
        );
        const subagentInfo = getAgentDisplayInfo(
          subagentId,
          subagentConfig ?? null,
        );
        return {
          id: subagentId,
          name: subagentConfig?.name ?? subagentInfo.name,
          emoji: subagentInfo.emoji,
          color: subagentInfo.color,
        };
      });

      return {
        id: agent.id,
        name: agent.name ?? agentInfo.name,
        emoji: agentInfo.emoji,
        color: agentInfo.color,
        model: agent.model?.primary ?? config.agents.defaults?.model?.primary ?? "unknown",
        workspace: agent.workspace,
        dmPolicy:
          telegramAccount?.dmPolicy ??
          config.channels?.telegram?.dmPolicy ??
          "pairing",
        allowAgents,
        allowAgentsDetails,
        botToken: botToken ? "configured" : undefined,
        status,
        lastActivity,
        activeSessions,
      };
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error reading agents:", error);
    return NextResponse.json(
      { error: "Failed to load agents" },
      { status: 500 },
    );
  }
}
