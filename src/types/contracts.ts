export type RunStatus = "running" | "success" | "failed";

export type RadarStatus = "active" | "paused";

export type NotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "unknown";

export interface RadarRules {
  radarName: string;
  subject: string;
  aliases: string[];
  includeTopics: string[];
  excludeTopics: string[];
  searchQuery: string;
  importanceThreshold: number;
  intervalMinutes: 360;
}

export interface EditableRuleDelta {
  radarName: string;
  includeTopics: string[];
  excludeTopics: string[];
}

export interface Candidate {
  sourceType: "tavily" | "rss";
  sourceDomain: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
}

export interface SourceOutcome {
  source: "tavily" | "rss";
  success: boolean;
  candidateCount: number;
  errorCode: string | null;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  candidateCount: number;
  relevantCount: number;
  notificationCount: number;
}
