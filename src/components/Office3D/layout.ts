/**
 * Office 3D — pure scene logic (no three.js imports so tests can load it
 * with a plain TypeScript transpile, see layout.test.mjs).
 */

import type { JiraIssue } from "@/lib/jira";

/** Radius of the circular command deck. */
export const ROOM_RADIUS = 16;

/** Where the Jira holo-board floats (back wall, facing the room center). */
export const BOARD_POSITION: [number, number, number] = [0, 4.4, -13];

export interface DeskPlacement {
  position: [number, number, number];
  /** Yaw so the desk's local +z axis points at the central core. */
  rotationY: number;
}

const MIN_DESK_SPACING = 3.2;
/** Desks span at most 270°, leaving the board side of the deck open. */
const MAX_ARC_SPAN = Math.PI * 1.5;

/**
 * Arrange `count` agent pods on an arc around the central core, opening
 * toward the Jira board at -z. Deterministic and collision-free.
 */
export function computeDeskLayout(count: number): DeskPlacement[] {
  if (count <= 0) return [];
  const radius = Math.max(7, (MIN_DESK_SPACING * (count - 1)) / MAX_ARC_SPAN);
  const span =
    count === 1 ? 0 : Math.min(MAX_ARC_SPAN, (MIN_DESK_SPACING * (count - 1)) / radius);
  const start = -span / 2;
  return Array.from({ length: count }, (_, i) => {
    const theta = count === 1 ? 0 : start + (span * i) / (count - 1);
    // theta = 0 → +z (the side opposite the board)
    const x = radius * Math.sin(theta);
    const z = radius * Math.cos(theta);
    return {
      position: [x, 0, z] as [number, number, number],
      rotationY: Math.atan2(-x, -z),
    };
  });
}

export type AgentActivity = "working" | "online" | "offline";

export function agentActivity(agent: {
  status: string;
  activeSessions?: number;
  isActive?: boolean;
}): AgentActivity {
  if ((agent.activeSessions ?? 0) > 0 || agent.isActive) return "working";
  return agent.status === "online" ? "online" : "offline";
}

export interface ActivityVisual {
  label: string;
  /** Emissive intensity multiplier for the avatar core / desk trim. */
  glow: number;
  /** Speed of the idle float / pulse animation. */
  pulseSpeed: number;
  /** Overall opacity — offline agents render as ghosts. */
  opacity: number;
  /** Indicator color used by the HUD legend and name plates. */
  indicator: string;
}

export const ACTIVITY_VISUALS: Record<AgentActivity, ActivityVisual> = {
  working: { label: "WORKING", glow: 2.4, pulseSpeed: 2.6, opacity: 1, indicator: "#22d3ee" },
  online: { label: "ONLINE", glow: 1.1, pulseSpeed: 0.9, opacity: 1, indicator: "#34d399" },
  offline: { label: "OFFLINE", glow: 0.25, pulseSpeed: 0.3, opacity: 0.35, indicator: "#64748b" },
};

/** Mirrors JIRA_COLUMNS in src/lib/jira.ts (kept local: this module may only use type imports). */
export const BOARD_COLUMNS = ["To Do", "In Progress", "Done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/**
 * Group issues into board columns. /jira drops issues whose status is not an
 * exact column name; here unknown statuses fold into the nearest bucket so
 * every issue stays visible on the hologram.
 */
export function groupIssues(issues: JiraIssue[]): Record<BoardColumn, JiraIssue[]> {
  const grouped: Record<BoardColumn, JiraIssue[]> = {
    "To Do": [],
    "In Progress": [],
    Done: [],
  };
  for (const issue of issues) {
    const s = issue.status.toLowerCase();
    if (s === "done" || s === "closed" || s === "resolved") grouped.Done.push(issue);
    else if (s.includes("progress") || s.includes("review")) grouped["In Progress"].push(issue);
    else grouped["To Do"].push(issue);
  }
  return grouped;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
