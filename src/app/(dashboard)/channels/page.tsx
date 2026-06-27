"use client";

import { useEffect, useState, useCallback } from "react";
import { Hash, RefreshCw, AlertCircle } from "lucide-react";
import { SlackChannelCard } from "@/components/SlackChannelCard";
import type { ChannelResult } from "@/app/api/slack/channels/route";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/slack/channels");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChannels(data.channels ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    const interval = setInterval(fetchChannels, 60_000);
    return () => clearInterval(interval);
  }, [fetchChannels]);

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-3xl font-bold mb-1"
            style={{
              fontFamily: "var(--font-heading)",
              color: "var(--text-primary)",
              letterSpacing: "-1.5px",
            }}
          >
            <Hash className="inline-block w-8 h-8 mr-2 mb-1" />
            Slack Channels
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Live feed from NeuralOps workspace
            {lastUpdated && (
              <span style={{ color: "var(--text-muted)", marginLeft: "8px" }}>
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchChannels(); }}
          className="flex items-center gap-2"
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "var(--card)",
            color: "var(--text-primary)",
            borderRadius: "0.5rem",
            border: "1px solid var(--border)",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-4 flex items-center gap-3 p-4 rounded-xl"
          style={{
            backgroundColor: "color-mix(in srgb, var(--negative) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--negative) 30%, transparent)",
          }}
        >
          <AlertCircle className="w-5 h-5" style={{ color: "var(--negative)" }} />
          <span style={{ color: "var(--negative)" }}>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && channels.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div
            style={{
              width: "2rem",
              height: "2rem",
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <style jsx global>{`
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map((channel) => (
            <SlackChannelCard
              key={channel.name}
              name={channel.name}
              channelId={channel.channelId}
              messages={channel.messages}
              error={channel.error}
            />
          ))}
        </div>
      )}
    </div>
  );
}
