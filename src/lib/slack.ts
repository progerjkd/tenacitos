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

const CHANNEL_IDS: Record<string, string> = {
  "#ops": process.env.SLACK_CHANNEL_OPS ?? "",
  "#content": process.env.SLACK_CHANNEL_CONTENT ?? "",
  "#dev": process.env.SLACK_CHANNEL_DEV ?? "",
  "#trading": process.env.SLACK_CHANNEL_TRADING ?? "",
  "#roblox": process.env.SLACK_CHANNEL_ROBLOX ?? "",
};

export const SLACK_CHANNELS = Object.keys(CHANNEL_IDS);

export async function resolveChannelId(channelName: string): Promise<string | null> {
  // Try env var first (fastest)
  if (CHANNEL_IDS[channelName]) return CHANNEL_IDS[channelName];

  // Fall back to conversations.list lookup
  const name = channelName.replace(/^#/, "");
  let cursor: string | undefined;

  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      exclude_archived: "true",
      types: "public_channel,private_channel",
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${SLACK_API}/conversations.list?${params}`, {
      headers: { Authorization: slackAuthHeader() },
      next: { revalidate: 3600 },
    });
    const data = (await res.json()) as {
      ok: boolean;
      channels: Array<{ id: string; name: string }>;
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) return null;
    const match = data.channels.find((c) => c.name === name);
    if (match) return match.id;
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return null;
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
  };
  if (!data.ok || !data.messages) return [];
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
