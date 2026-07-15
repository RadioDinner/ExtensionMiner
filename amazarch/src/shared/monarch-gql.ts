// Shared Monarch GraphQL transport. Authenticates the way the web app does —
// a credentialed request carrying the session cookie + X-CSRFToken (proven in
// M0) — with a bearer token as a fallback. The endpoint moved to api.monarch.com
// in Jan 2026 (SPEC.md §R3); it is configurable, never hardcoded to the old host.

const ENDPOINTS = ["https://api.monarch.com/graphql", "https://api.monarchmoney.com/graphql"];

export interface MonarchAuth {
  origin: string;
  csrftoken: string | null;
  deviceUuid: string | null;
  token: string | null; // optional bearer token fallback
}

export interface GqlDoc {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface GqlResult {
  ok: boolean; // HTTP 2xx with a data payload and no graphql errors
  status: number;
  method: "cookie" | "bearer" | null;
  host: string | null;
  data: unknown;
  errors: string[];
  note: string; // short, no financial data
}

type Method = "cookie" | "bearer";

/** Read a single cookie value from a document.cookie string. */
export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

export async function gqlRequest(auth: MonarchAuth, doc: GqlDoc): Promise<GqlResult> {
  const methods: Method[] = [];
  if (auth.csrftoken) methods.push("cookie");
  if (auth.token) methods.push("bearer");
  if (methods.length === 0) methods.push("cookie");

  const body = JSON.stringify(doc);
  let last: GqlResult = {
    ok: false,
    status: 0,
    method: null,
    host: null,
    data: null,
    errors: [],
    note: "no attempt made",
  };

  for (const method of methods) {
    for (const endpoint of ENDPOINTS) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Client-Platform": "web",
      };
      if (auth.deviceUuid) headers["device-uuid"] = auth.deviceUuid;
      let credentials: RequestCredentials = "omit";
      if (method === "cookie") {
        credentials = "include";
        if (auth.csrftoken) headers["X-CSRFToken"] = auth.csrftoken;
      } else {
        headers["Authorization"] = `Token ${auth.token}`;
      }
      const host = new URL(endpoint).host;
      try {
        const res = await fetch(endpoint, { method: "POST", headers, body, credentials });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          // non-JSON error/challenge page
        }
        const errors = graphqlErrors(json);
        const data = dataOf(json);
        if (res.ok && data !== null && errors.length === 0) {
          return {
            ok: true,
            status: res.status,
            method,
            host,
            data,
            errors: [],
            note: `${doc.operationName} ok (${method}) via ${host}`,
          };
        }
        last = {
          ok: false,
          status: res.status,
          method,
          host,
          data,
          errors,
          note: errors.length
            ? `${method}@${host}: HTTP ${res.status}, graphql: ${errors[0]}`
            : `${method}@${host}: HTTP ${res.status}`,
        };
      } catch (e) {
        last = {
          ok: false,
          status: 0,
          method,
          host,
          data: null,
          errors: [],
          note: `${method}@${host}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
  }
  return last;
}

function dataOf(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return null;
  const data = (json as Record<string, unknown>)["data"];
  return data ?? null;
}

function graphqlErrors(json: unknown): string[] {
  if (typeof json !== "object" || json === null) return [];
  const errors = (json as Record<string, unknown>)["errors"];
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => (e as Record<string, unknown>)?.["message"])
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.slice(0, 160));
}
