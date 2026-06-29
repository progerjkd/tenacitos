const SLACK_API = "https://slack.com/api";

export interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  botId?: string;
  username?: string;
}

export interface SlackUserInfo {
  displayName: string;
  avatarUrl: string;
  isBot: boolean;
}

function slackAuthHeader(): string {
  return `Bearer ${process.env.SLACK_BOT_TOKEN ?? ""}`;
}

const CHANNEL_ENV_VARS: Record<string, string> = {
  "#ops": "SLACK_CHANNEL_OPS",
  "#content": "SLACK_CHANNEL_CONTENT",
  "#dev": "SLACK_CHANNEL_DEV",
  "#trading": "SLACK_CHANNEL_TRADING",
  "#roblox": "SLACK_CHANNEL_ROBLOX",
};

export const SLACK_CHANNELS = Object.keys(CHANNEL_ENV_VARS);

interface SlackChannelListBody {
  ok: boolean;
  channels?: Array<{ id: string; name: string }>;
  response_metadata?: { next_cursor?: string };
  error?: string;
  needed?: string;
  provided?: string;
}

export class SlackLookupError extends Error {
  code?: string;
  needed?: string;

  constructor(message: string, details: { code?: string; needed?: string } = {}) {
    super(message);
    this.name = "SlackLookupError";
    this.code = details.code;
    this.needed = details.needed;
  }
}

export function slackChannelEnvVar(channelName: string): string | null {
  return CHANNEL_ENV_VARS[channelName] ?? null;
}

function configuredChannelId(channelName: string): string {
  const envVar = slackChannelEnvVar(channelName);
  return envVar ? process.env[envVar] ?? "" : "";
}

function ensureSlackToken() {
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new SlackLookupError("Slack bot token is not configured. Set SLACK_BOT_TOKEN.");
  }
}

function slackApiError(
  action: string,
  data: { error?: string; needed?: string },
): SlackLookupError {
  const code = data.error ?? "unknown_error";
  const needed = data.needed ? ` Needed scope: ${data.needed}.` : "";
  return new SlackLookupError(`Slack ${action} failed: ${code}.${needed}`, {
    code,
    needed: data.needed,
  });
}

async function findChannelIdByName(
  channelName: string,
  type: "public_channel" | "private_channel",
): Promise<string | null> {
  const name = channelName.replace(/^#/, "");
  let cursor: string | undefined;

  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      exclude_archived: "true",
      types: type,
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${SLACK_API}/conversations.list?${params}`, {
      headers: { Authorization: slackAuthHeader() },
      next: { revalidate: 3600 },
    });
    const data = (await res.json()) as SlackChannelListBody;

    if (!data.ok) throw slackApiError(`channel lookup for ${channelName}`, data);

    const match = data.channels?.find((c) => c.name === name);
    if (match) return match.id;

    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return null;
}

export async function resolveChannelId(channelName: string): Promise<string | null> {
  // Try env var first (fastest)
  const configuredId = configuredChannelId(channelName);
  if (configuredId) return configuredId;

  ensureSlackToken();

  const publicChannelId = await findChannelIdByName(channelName, "public_channel");
  if (publicChannelId) return publicChannelId;

  try {
    return await findChannelIdByName(channelName, "private_channel");
  } catch (error) {
    if (error instanceof SlackLookupError && error.code === "missing_scope") {
      const envVar = slackChannelEnvVar(channelName) ?? "SLACK_CHANNEL_*";
      throw new SlackLookupError(
        `Channel ${channelName} was not found in public channels, and private channel lookup is unavailable. Set ${envVar} to the channel ID or add the ${error.needed ?? "groups:read"} Slack scope.`,
        { code: error.code, needed: error.needed },
      );
    }
    throw error;
  }
}

export async function getChannelHistory(
  channelId: string,
  limit = 10,
): Promise<SlackMessage[]> {
  const res = await fetch(
    `${SLACK_API}/conversations.history?channel=${channelId}&limit=${limit}`,
    {
      headers: { Authorization: slackAuthHeader() },
      next: { revalidate: 0 },
    },
  );
  const data = (await res.json()) as {
    ok: boolean;
    messages?: SlackMessage[];
    error?: string;
    needed?: string;
  };
  if (!data.ok) throw slackApiError("channel history lookup", data);
  if (!data.messages) return [];
  return data.messages;
}

export async function getUserInfo(userId: string): Promise<SlackUserInfo | null> {
  const res = await fetch(`${SLACK_API}/users.info?user=${userId}`, {
    headers: { Authorization: slackAuthHeader() },
    next: { revalidate: 3600 },
  });
  const data = (await res.json()) as {
    ok: boolean;
    user?: {
      name: string;
      real_name: string;
      is_bot: boolean;
      profile: {
        display_name: string;
        image_48: string;
      };
    };
  };
  if (!data.ok || !data.user) return null;
  return {
    displayName: data.user.profile.display_name || data.user.real_name || data.user.name,
    avatarUrl: data.user.profile.image_48,
    isBot: data.user.is_bot,
  };
}

export async function sendSlackMessage(
  channelName: string,
  text: string,
  blocks?: unknown[],
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const channelId = await resolveChannelId(channelName);
  if (!channelId) return { ok: false, error: `Channel not found: ${channelName}` };

  const body: Record<string, unknown> = { channel: channelId, text };
  if (blocks) body.blocks = blocks;

  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: slackAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  return data;
}
