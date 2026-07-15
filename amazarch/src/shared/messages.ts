// Runtime messages between the content scripts, background, and popup.

export type AuthMethod = "cookie" | "bearer" | "none";

export interface MonarchSessionInfo {
  authMethod: AuthMethod;
  token: string | null; // present only for bearer auth
  deviceUuid: string | null;
  origin: string; // which Monarch host the session was captured from
  capturedAt: number; // epoch ms
  strategy: string; // how the session was established (diagnostics)
}

export interface ProbeResult {
  ranAt: number;
  status: number; // HTTP status, or 0 if the request never completed
  ok: boolean; // true only when the API returned an authenticated `me`
  note: string; // short human-readable outcome (no financial data)
}

export interface ReadResult {
  ranAt: number;
  ok: boolean;
  amazonCount: number;
  totalScanned: number;
  totalCount: number | null;
  note: string;
}

export interface AmazonStatus {
  ranAt: number;
  ok: boolean; // we reached a recognizable Amazon page
  signedIn: boolean;
  orderCardCount: number;
  note: string;
}

export type Message =
  | {
      type: "monarch-connected";
      session: MonarchSessionInfo;
      probe: ProbeResult;
      read: ReadResult | null;
    }
  | { type: "content-script-loaded"; origin: string; loadedAt: number }
  | { type: "get-status" };

export interface StatusResponse {
  monarch: (Omit<MonarchSessionInfo, "token"> & { tokenPreview: string }) | null;
  probe: ProbeResult | null;
  read: ReadResult | null;
  amazon: AmazonStatus | null;
  /** Origins where the Monarch content script has reported in this browser session. */
  contentScriptOrigins: string[];
}

/** Redact a token for display; describe cookie sessions plainly. Never emit a full token. */
export function tokenPreview(token: string | null): string {
  if (!token) return "(cookie session)";
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
