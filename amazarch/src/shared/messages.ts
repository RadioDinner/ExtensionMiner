// Runtime messages between the content scripts, background, and popup.

export interface MonarchSessionInfo {
  token: string;
  deviceUuid: string | null;
  origin: string; // which Monarch host the session was captured from
  capturedAt: number; // epoch ms
  strategy: string; // which token-hunt strategy found it (diagnostics)
}

export interface ProbeResult {
  ranAt: number;
  status: number; // HTTP status, or 0 if the request never completed
  ok: boolean; // true only when the API returned an authenticated `me`
  note: string; // short human-readable outcome (no financial data)
}

export type Message =
  | { type: "monarch-session-detected"; session: MonarchSessionInfo }
  | { type: "content-script-loaded"; origin: string; loadedAt: number }
  | { type: "get-status" };

export interface StatusResponse {
  monarch: (Omit<MonarchSessionInfo, "token"> & { tokenPreview: string }) | null;
  probe: ProbeResult | null;
  /** Origins where the Monarch content script has reported in this browser session. */
  contentScriptOrigins: string[];
}

/** Redact a token down to a short identifiable preview (never log/show full tokens). */
export function tokenPreview(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
