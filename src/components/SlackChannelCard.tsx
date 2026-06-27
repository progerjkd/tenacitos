"use client";

import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import type { SlackMessage, SlackUserInfo } from "@/lib/slack";

interface SlackChannelCardProps {
  name: string;
  channelId: string | null;
  messages: Array<SlackMessage & { userInfo?: SlackUserInfo | null }>;
  error?: string;
}

function fmtSlackTs(ts: string): string {
  const ms = parseFloat(ts) * 1000;
  return new Date(ms).toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function slackUrl(channelId: string | null): string {
  return channelId
    ? `https://app.slack.com/client/${channelId}`
    : "https://app.slack.com";
}

export function SlackChannelCard({
  name,
  channelId,
  messages,
  error,
}: SlackChannelCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const latestTs = messages[0]?.ts;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3"
        style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)", cursor: "pointer", background: "none", border: "none" }}
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
          )}
          <span
            className="font-mono font-semibold"
            style={{ color: "var(--text-primary)", fontSize: "13px" }}
          >
            {name}
          </span>
          {error && (
            <span
              style={{
                fontSize: "11px",
                color: "var(--negative)",
                backgroundColor: "color-mix(in srgb, var(--negative) 12%, transparent)",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              unavailable
            </span>
          )}
          {!error && (
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                backgroundColor: "var(--surface-elevated)",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              {messages.length} messages
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {latestTs && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {fmtSlackTs(latestTs)}
            </span>
          )}
          <a
            href={slackUrl(channelId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: "var(--text-muted)" }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </button>

      {/* Messages */}
      {!collapsed && (
        <div>
          {error && (
            <p
              className="px-5 py-3 text-sm italic"
              style={{ color: "var(--text-muted)" }}
            >
              {error}
            </p>
          )}
          {!error && messages.length === 0 && (
            <p
              className="px-5 py-3 text-sm italic"
              style={{ color: "var(--text-muted)" }}
            >
              No recent messages.
            </p>
          )}
          {messages.map((msg, i) => {
            const isBot = !!(msg.botId ?? msg.userInfo?.isBot);
            const displayName =
              msg.userInfo?.displayName ?? msg.username ?? msg.user ?? "Unknown";

            return (
              <div
                key={msg.ts}
                className="flex gap-3 px-5 py-2.5"
                style={{
                  borderTop: i === 0 ? "1px solid var(--border)" : "none",
                  borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
                  backgroundColor: isBot
                    ? "color-mix(in srgb, var(--accent) 4%, transparent)"
                    : "transparent",
                }}
              >
                {/* Avatar */}
                {msg.userInfo?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={msg.userInfo.avatarUrl}
                    alt={displayName}
                    className="w-7 h-7 rounded flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded flex-shrink-0 mt-0.5 flex items-center justify-center text-xs font-bold"
                    style={{
                      backgroundColor: "var(--surface-elevated)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {displayName[0]?.toUpperCase() ?? "?"}
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color: isBot ? "var(--accent)" : "var(--text-secondary)",
                      }}
                    >
                      {displayName}
                      {isBot && (
                        <span
                          className="ml-1 font-mono font-normal"
                          style={{ color: "var(--text-muted)", fontSize: "10px" }}
                        >
                          APP
                        </span>
                      )}
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: "10px", color: "var(--text-muted)" }}
                    >
                      {fmtSlackTs(msg.ts)}
                    </span>
                  </div>
                  <p
                    className="text-xs break-words"
                    style={{ color: "var(--text-primary)", lineHeight: "1.5" }}
                  >
                    {msg.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
