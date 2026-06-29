import path from 'path';

/**
 * Centralized path configuration.
 * In production (VPS), these default to /root/.openclaw paths.
 * For local development, override via environment variables.
 */
export const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/root/.openclaw';
export const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_DIR, 'workspace');
export const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
export const OPENCLAW_MEDIA = path.join(OPENCLAW_DIR, 'media');

export const WORKSPACE_IDENTITY = path.join(OPENCLAW_WORKSPACE, 'IDENTITY.md');
export const WORKSPACE_TOOLS = path.join(OPENCLAW_WORKSPACE, 'TOOLS.md');
export const WORKSPACE_MEMORY = path.join(OPENCLAW_WORKSPACE, 'memory');

export const SYSTEM_SKILLS_PATH = '/usr/lib/node_modules/openclaw/skills';
export const WORKSPACE_SKILLS_PATH = path.join(OPENCLAW_DIR, 'workspace-infra', 'skills');

/** Allowed base paths for media/file serving */
export const ALLOWED_MEDIA_PREFIXES = [
  path.join(OPENCLAW_WORKSPACE, '/'),
  path.join(OPENCLAW_MEDIA, '/'),
];

/**
 * Resolves a workspace ID to an absolute path.
 * Handles static IDs (workspace, mission-control) and dynamic agent-* IDs
 * sourced from openclaw.json so that file mutations work for all workspaces.
 */
export function resolveWorkspacePath(id: string): string | null {
  const staticMap: Record<string, string> = {
    workspace: OPENCLAW_WORKSPACE,
    'mission-control': path.join(OPENCLAW_DIR, 'workspace', 'mission-control'),
  };
  if (staticMap[id]) return staticMap[id];

  if (id.startsWith('agent-')) {
    const agentId = id.slice('agent-'.length);
    try {
      const { readFileSync } = require('fs');
      const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'));
      const agent = (config?.agents?.list ?? []).find(
        (a: { id: string }) => a.id === agentId,
      );
      return agent?.workspace ?? null;
    } catch {
      return null;
    }
  }
  return null;
}
