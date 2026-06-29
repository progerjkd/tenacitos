import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { OPENCLAW_DIR, OPENCLAW_WORKSPACE, OPENCLAW_CONFIG } from '@/lib/paths';

interface Workspace {
  id: string;
  name: string;
  emoji: string;
  path: string;
  agentName?: string;
}

function getAgentInfo(workspacePath: string): { name: string; emoji: string } | null {
  const identityPath = path.join(workspacePath, 'IDENTITY.md');

  if (!fs.existsSync(identityPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(identityPath, 'utf-8');

    const nameMatch = content.match(/- \*\*Name:\*\* (.+)/);
    const emojiMatch = content.match(/- \*\*Emoji:\*\* (.+)/);

    let emoji = '📁';
    if (emojiMatch) {
      const emojiText = emojiMatch[1].trim();
      emoji = emojiText.split(' ')[0];
    }

    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      emoji,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const workspaces: Workspace[] = [];

    // Main workspace
    if (fs.existsSync(OPENCLAW_WORKSPACE)) {
      const mainInfo = getAgentInfo(OPENCLAW_WORKSPACE);
      workspaces.push({
        id: 'workspace',
        name: process.env.NEXT_PUBLIC_AGENT_NAME || 'Main Workspace',
        emoji: mainInfo?.emoji || (process.env.NEXT_PUBLIC_AGENT_EMOJI || '🤖'),
        path: OPENCLAW_WORKSPACE,
        agentName: mainInfo?.name || undefined,
      });
    }

    // Legacy: scan OPENCLAW_DIR for workspace-* subdirectories
    if (fs.existsSync(OPENCLAW_DIR)) {
      const entries = fs.readdirSync(OPENCLAW_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('workspace-')) {
          const workspacePath = path.join(OPENCLAW_DIR, entry.name);
          const agentInfo = getAgentInfo(workspacePath);
          const agentId = entry.name.replace('workspace-', '');
          const workspaceLabel = agentId.charAt(0).toUpperCase() + agentId.slice(1);

          workspaces.push({
            id: entry.name,
            name: workspaceLabel,
            emoji: agentInfo?.emoji || '🤖',
            path: workspacePath,
            agentName: agentInfo?.name || undefined,
          });
        }
      }
    }

    // Read agent workspaces from openclaw.json config
    try {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
      const agentList: Array<{ id: string; name?: string; workspace?: string }> = config?.agents?.list || [];

      for (const agent of agentList) {
        if (!agent.workspace || agent.id === 'main') continue;
        if (!fs.existsSync(agent.workspace)) continue;
        // Skip if already added (avoid duplicates)
        if (workspaces.some(w => w.path === agent.workspace)) continue;

        const agentInfo = getAgentInfo(agent.workspace);
        const label = agent.name
          ? agent.name.charAt(0).toUpperCase() + agent.name.slice(1)
          : agent.id.charAt(0).toUpperCase() + agent.id.slice(1);

        workspaces.push({
          id: `agent-${agent.id}`,
          name: label,
          emoji: agentInfo?.emoji || '🤖',
          path: agent.workspace,
          agentName: agentInfo?.name || agent.name || agent.id,
        });
      }
    } catch {
      // openclaw.json missing or invalid — skip agent workspaces
    }

    // Sort: main first, then alphabetically
    workspaces.sort((a, b) => {
      if (a.id === 'workspace') return -1;
      if (b.id === 'workspace') return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ workspaces });
  } catch (error) {
    console.error('Failed to list workspaces:', error);
    return NextResponse.json({ workspaces: [] }, { status: 500 });
  }
}
