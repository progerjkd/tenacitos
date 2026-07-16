# Office 3D — "NeuralOps HQ" redesign

**Date:** 2026-07-15
**Route:** `/office`

## Problem

The current 3D office renders a hardcoded agent roster (`agent-2`…`agent-6` in
`src/components/Office3D/agentsConfig.ts`) with mock in-component state, so it never matches
the real OpenClaw agents shown on `/agents` (Max, Iris, Quinn, Echo, Vale, Pixel — served by
`/api/agents` from `openclaw.json`). The `/api/office` status feed also carries a stale agent
map from an older deployment (`academic`, `studio`, `linkedin`, …). The office also has no
view of the NEURALOPS Jira board that `/jira` renders.

## Goals

1. Replace the scene with a new, futuristic "holographic command deck" aesthetic.
2. Drive the office from the same data source as `/agents` so the rosters always match,
   including agents added later without code changes.
3. Embed the NEURALOPS Jira board inside the scene as a 3D holographic kanban.

## Non-goals

- No changes to the legacy 2D office experiments (`src/components/office/*`).
- No new npm dependencies (bloom via `@react-three/postprocessing` was considered and
  rejected: peer-dep/install risk for a purely cosmetic gain; emissive materials + additive
  sprites + custom shaders achieve the neon look with the existing stack).
- No writes to Jira from the 3D scene (cards deep-link to Jira; mutations stay on `/jira`).

## Design

### Data flow

- `useOfficeData` hook polls:
  - `GET /api/agents` every 30 s → identity (id, name, emoji, color), model, online/offline
    status, activeSessions, lastActivity. Single source of truth shared with `/agents`.
  - `GET /api/office` every 30 s → per-agent `currentTask` + `isActive` (gateway sessions with
    file fallback), merged by agent id for speech bubbles / desk screens.
  - `GET /api/jira/issues` every 60 s → NEURALOPS issues grouped into To Do / In Progress /
    Done (statuses outside those columns fold into the nearest bucket, mirroring `/jira`).
- All fetches are best-effort: the scene renders with whatever subset arrives; failures show
  a subtle "OFFLINE FEED" badge instead of breaking the canvas.
- `/api/office` is refactored to derive names/emoji/colors/roles from `AGENT_DEFS`
  (`src/lib/agents-config.ts`) + `openclaw.json` `ui` overrides instead of its stale local map.

### Scene composition (all new, in `src/components/Office3D/`)

- `Office3D.tsx` — canvas, data wiring, HUD overlay, control-mode toggle (orbit ↔ FPS,
  reusing the existing `FirstPersonControls`).
- `layout.ts` — pure functions: `computeDeskLayout(n)` arranges n agent pods in an arc facing
  a central holo-core, deterministic and collision-free for 1–16 agents; status → visual
  mapping (`statusVisual`). Unit-tested.
- `HoloDesk.tsx` — floating glass workstation: dark glass slab, emissive trim in the agent's
  color, curved holo-screen with an animated shader (scrolling glyph rain), floor status ring.
- `HoloAvatar.tsx` — the agent: levitating core orb + counter-rotating rings, emoji + name
  billboard, task bubble when active. Status drives animation: working = fast pulse + bright,
  online-idle = slow float, offline = dimmed ghost.
- `JiraHoloBoard.tsx` — wall-scale holographic kanban titled NEURALOPS BOARD: three columns
  with count badges, issue cards (key, truncated summary, priority dot, assignee initial);
  clicking a card opens the Jira issue in a new tab; a footer link opens `/jira`.
- `CentralCore.tsx` — rotating holographic column in the room's center (rings + particles +
  "NEURALOPS" ticker) acting as the visual anchor and desk-arc focus.
- `Environment.tsx` — night-void setting: drei `Stars`, floor with custom GLSL neon grid
  shader, perimeter light strips, `Sparkles` dust, fog; no daylight `Sky`.
- `AgentInfoPanel.tsx` — HTML side panel on agent click: real data (model, status, sessions,
  last activity, current task) + link to `/agents`.

### Removals

The old scene components that expressed the mock office are deleted: `agentsConfig.ts`,
`AgentDesk`, `AgentPanel`, `MovingAvatar`, `Avatar`, `AvatarModel`, `useAvatarModel`,
`ProceduralAvatars`, `VoxelAvatar`, `VoxelChair`, `VoxelKeyboard`, `VoxelMacMini`,
`CoffeeMachine`, `FileCabinet`, `PlantPot`, `WallClock`, `Whiteboard`, `Walls`, `Floor`,
`Lights`, and the old `Office3D.test.mjs` (it asserted the mock-state map). Kept:
`FirstPersonControls`.

### Error handling

- Canvas is client-only (`dynamic` import, unchanged page shell) with a themed loader.
- Each poll failure keeps last-good data and flags the HUD; empty agent list renders the
  environment plus an "NO AGENTS DETECTED" hologram rather than crashing.
- Jira 502 (missing env) hides the board content and shows "BOARD FEED OFFLINE" on the panel.

### Testing

- `layout.test.mjs`: desk positions are unique/non-overlapping and within room bounds for
  1–16 agents; all face the core; status mapping covers every status.
- `jira-grouping` covered via a pure `groupIssues` helper exported from the board module and
  exercised in the same test file.
- Manual/build verification: `npm test`, `npm run lint`, `npm run build`.
