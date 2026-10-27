// Only the fields the CLI reads. The API returns more; `--json` shows everything.

export interface ProjectRef {
  id: string;
  slug: string | null;
  name: string;
}

export interface Issue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string | null;
  level: string;
  status: string;
  count: string;
  userCount?: number | null;
  numComments: number;
  firstSeen: string;
  lastSeen: string;
  permalink?: string | null;
  project: ProjectRef;
  firstRelease?: { version?: string } | null;
  lastRelease?: { version?: string } | null;
  metadata?: Record<string, unknown>;
}

export interface IssueEvent {
  id: string;
  eventID: string;
  groupID: string;
  dateCreated: string;
  title: string;
  message?: string;
  platform?: string | null;
  tags?: { key: string; value: string }[];
  user?: { id?: string; email?: string; username?: string; ip_address?: string } | null;
  entries?: { type: string; data: unknown }[];
}

export interface Comment {
  id: number | null;
  dateCreated: string;
  user: { name?: string; username?: string; email?: string } | null;
  data: { text?: string } & Record<string, unknown>;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  dateCreated: string;
}

export interface Project {
  id: string;
  slug: string | null;
  name: string;
  platform?: string | null;
  firstEvent?: string | null;
  dateCreated: string;
}

export interface LogEvent {
  id: string;
  timestamp: string;
  level: string;
  body: string;
  service?: string | null;
  environment?: string | null;
  host?: string | null;
  projectId: number;
}

export interface TransactionGroup {
  id: number;
  project: number;
  transaction: string;
  op: string;
  method?: string | null;
  count: number;
  avgDuration: number;
  p50?: number | null;
  p95?: number | null;
  errorCount: number;
  errorRate: number;
}

export interface SpanGroup {
  op: string;
  description: string;
  count: number;
  avgDuration: number;
  p95Duration: number;
  totalTime: number;
}

export interface NPlusOne {
  transactionName: string;
  op: string;
  description: string;
  totalSpans: number;
  transactionCount: number;
  spansPerTxn: number;
  avgDuration: number;
  totalTime: number;
}

export interface TrendPoint {
  date: string;
  count: number;
  avgDuration: number;
  totalTime: number;
}

export interface Monitor {
  id: number;
  name: string;
  monitorType: string;
  url?: string | null;
  isUp: boolean | null;
  interval: number;
  projectName?: string | null;
  envName?: string | null;
  lastChange?: string | null;
}

export interface MonitorCheck {
  startCheck: string;
  isUp: boolean;
  reason?: number | null;
  responseTime?: number | null;
}

export interface ProjectAlert {
  id: number | null;
  name: string | null;
  timespanMinutes: number | null;
  quantity: number | null;
  uptime: boolean;
}

export interface IssueTag {
  key: string;
  name: string;
  totalValues: number;
  uniqueValues: number;
  topValues: { value: string; count: number }[];
}

export interface IssueHash {
  id: string;
  latestEvent: { eventID: string; dateCreated: string } | null;
}
