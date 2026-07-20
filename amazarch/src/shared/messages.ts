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

/** One known Amazon account and how much of its order history we hold. */
export interface AmazonAccountSummary {
  label: string; // display name read from the Amazon nav ("Derrick"), or a default
  count: number; // orders cached for this account
  lastSync: number; // epoch ms of the last successful scrape
  active: boolean; // the account signed in during the most recent sync
}

// AmazonOrder is defined in shared/amazon-order-parse to avoid a cycle; re-export
// the shape here for message typing.
export interface AmazonOrderLite {
  orderId: string;
  date: string;
  totalCents: number;
  itemTitles: string[];
  /** Card text shows a completed return/refund ("Refund issued", "Return
   *  complete"). Optional so older callers/fixtures stay valid. */
  returnHint?: boolean;
  /** Which Amazon account this order was scraped from (multi-account, D11).
   *  Optional so older callers/fixtures stay valid. */
  account?: string;
}

export interface AmazonCheck {
  status: AmazonStatus;
  orders: AmazonOrderLite[]; // the UNION of every known account's cached orders
  accounts?: AmazonAccountSummary[]; // all accounts we hold orders for
  activeAccount?: string | null; // the account signed in during this sync
  diagnostic?: Record<string, number | string>; // redacted counts when parsing found nothing
  sample?: string; // redacted structural skeleton of one order card (no values)
  report?: string; // full copyable diagnostic bundle (counts + JSON schema + skeleton), no values
}

export type Message =
  | {
      type: "monarch-connected";
      session: MonarchSessionInfo;
      probe: ProbeResult;
      read: ReadResult | null;
    }
  | { type: "content-script-loaded"; origin: string; loadedAt: number }
  | { type: "fetch-amazon" }
  | {
      type: "amazon-orders";
      orders: AmazonOrderLite[];
      signedIn: boolean;
      account?: string | null; // the signed-in account label read from the page
      diag?: { cardCount: number; decrypted: boolean; url: string; waited: number };
    }
  | { type: "amazon-progress"; label: string }
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
