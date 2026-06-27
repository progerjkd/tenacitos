export interface AgentDef {
  slug: string;
  name: string;
  emoji: string;
  color: string;
  cronNames: string[];
}

export const AGENT_DEFS: AgentDef[] = [
  { slug: "main",        name: "Max",   emoji: "🧠", color: "#ff6b35", cronNames: [] },
  { slug: "inbox",       name: "Iris",  emoji: "📥", color: "#6366f1", cronNames: ["inbox-classify", "inbox-surface"] },
  { slug: "brief",       name: "Quinn", emoji: "📅", color: "#0ea5e9", cronNames: ["brief-daily"] },
  { slug: "ghostwriter", name: "Echo",  emoji: "✍️", color: "#8b5cf6", cronNames: ["ghostwriter-weekly"] },
  { slug: "qa",          name: "Vale",  emoji: "🔍", color: "#10b981", cronNames: [] },
  { slug: "playsmith",   name: "Pixel", emoji: "🎮", color: "#f59e0b", cronNames: ["playsmith-saturday"] },
];

export function agentDefBySlug(slug: string): AgentDef | undefined {
  return AGENT_DEFS.find((a) => a.slug === slug);
}
