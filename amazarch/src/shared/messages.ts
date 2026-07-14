// Runtime messages between the content scripts, background, and popup.

export interface MonarchSessionInfo {
  token: string;
  deviceUuid: string | null;
  origin: string; // which Monarch host the session was captured from
  capturedAt: number; // epoch ms
}

export type Message =
  | { type: "monarch-session-detected"; session: MonarchSessionInfo }
  | { type: "get-status" };

export interface StatusResponse {
  monarch: (Omit<MonarchSessionInfo, "token"> & { tokenPreview: string }) | null;
}

/** Redact a token down to a short identifiable preview (never log/show full tokens). */
export function tokenPreview(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
