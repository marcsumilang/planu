export interface SyncCursor {
  mtime: number;
  id: string;
}

export interface PagedRows<T> {
  rows: T[];
  nextCursor?: SyncCursor;
}

export interface ItemsListArgs {
  type?: string;
  status?: string;
  projectId?: string;
  limit?: number;
  cursor?: SyncCursor;
}

export interface SyncPullResponse {
  items: unknown[];
  checkins: unknown[];
  tombstones: Array<{ id: string; deletedAt: number }>;
  serverTime: number;
}

export interface SyncPushItem {
  id?: string;
  title: string;
  body?: string;
  type?: string;
  status?: string;
  mtime: number;
  [key: string]: unknown;
}

export interface SyncPushRequest {
  items?: SyncPushItem[];
}

export interface SyncPushResponse {
  confirmedIds: string[];
  rejected: Array<{ id: string; reason: string }>;
}

export interface AgentItemsQuery {
  type?: string;
  status?: string;
  projectId?: string;
  limit?: number;
  cursor?: SyncCursor;
}
