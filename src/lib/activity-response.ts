export interface ActivityListItem {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  status: string;
  duration_ms: number | null;
  tokens_used: number | null;
  metadata?: Record<string, unknown>;
}

export interface ActivitiesResponse {
  activities: ActivityListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ActivityStatsResponse {
  total: number;
  today: number;
  heatmap: Array<{ day: string; count: number }>;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  trend: Array<{ day: string; count: number; success: number; errors: number }>;
  hourly: Array<{ hour: string; count: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeActivitiesResponse(
  value: unknown,
  fallbackLimit: number,
  fallbackOffset: number,
): ActivitiesResponse {
  if (!isRecord(value)) {
    return {
      activities: [],
      total: 0,
      limit: fallbackLimit,
      offset: fallbackOffset,
      hasMore: false,
    };
  }

  const activities = Array.isArray(value.activities)
    ? (value.activities as ActivityListItem[])
    : [];
  const total = numberOrDefault(value.total, activities.length);
  const limit = numberOrDefault(value.limit, fallbackLimit);
  const offset = numberOrDefault(value.offset, fallbackOffset);
  const hasMore = typeof value.hasMore === "boolean" ? value.hasMore : offset + activities.length < total;

  return { activities, total, limit, offset, hasMore };
}

export function normalizeActivityStats(value: unknown): ActivityStatsResponse {
  const source = isRecord(value) ? value : {};

  return {
    total: numberOrDefault(source.total, 0),
    today: numberOrDefault(source.today, 0),
    heatmap: Array.isArray(source.heatmap) ? source.heatmap as ActivityStatsResponse["heatmap"] : [],
    byType: isRecord(source.byType) ? source.byType as Record<string, number> : {},
    byStatus: isRecord(source.byStatus) ? source.byStatus as Record<string, number> : {},
    trend: Array.isArray(source.trend) ? source.trend as ActivityStatsResponse["trend"] : [],
    hourly: Array.isArray(source.hourly) ? source.hourly as ActivityStatsResponse["hourly"] : [],
  };
}
