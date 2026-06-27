import { NextResponse } from "next/server";
import {
  SLACK_CHANNELS,
  resolveChannelId,
  getChannelHistory,
  getUserInfo,
  type SlackMessage,
  type SlackUserInfo,
} from "@/lib/slack";

export const dynamic = "force-dynamic";

export interface ChannelResult {
  name: string;
  channelId: string | null;
  messages: Array<SlackMessage & { userInfo?: SlackUserInfo | null }>;
  error?: string;
}

export async function GET() {
  const results = await Promise.allSettled(
    SLACK_CHANNELS.map(async (channelName): Promise<ChannelResult> => {
      const channelId = await resolveChannelId(channelName);
      if (!channelId) {
        return {
          name: channelName,
          channelId: null,
          messages: [],
          error: "Channel not found — set SLACK_CHANNEL_* env vars",
        };
      }

      const messages = await getChannelHistory(channelId, 10);
      const messagesWithUsers = await Promise.all(
        messages.map(async (msg) => {
          const userInfo = msg.user
            ? await getUserInfo(msg.user).catch(() => null)
            : null;
          return { ...msg, userInfo };
        }),
      );

      return { name: channelName, channelId, messages: messagesWithUsers };
    }),
  );

  const channels: ChannelResult[] = results.map((r, i) => {
    if (r.status === "rejected") {
      return {
        name: SLACK_CHANNELS[i]!,
        channelId: null,
        messages: [],
        error: String(r.reason),
      };
    }
    return r.value;
  });

  return NextResponse.json({ channels });
}
