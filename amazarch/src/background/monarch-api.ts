// Minimal Monarch GraphQL client for the M0 connectivity probe.
// The endpoint moved to api.monarch.com in Jan 2026 (SPEC.md §R3); keep it
// configurable and never hardcode the old api.monarchmoney.com host.
import type { ProbeResult } from "../shared/messages";

const GRAPHQL_ENDPOINTS = ["https://api.monarch.com/graphql", "https://api.monarchmoney.com/graphql"];

interface ProbeInput {
  token: string;
  deviceUuid: string | null;
  origin: string; // the Monarch web origin, used for Origin/Referer headers
}

// A tiny authenticated query. If it returns data.me the token is real and the
// endpoint/headers are right; anything else is reported verbatim (status +
// first error message) so we can diagnose without exposing financial data.
const PROBE_BODY = JSON.stringify({
  operationName: "AmazarchProbe",
  query: "query AmazarchProbe { me { id } }",
  variables: {},
});

export async function probeMonarch(input: ProbeInput): Promise<ProbeResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Token ${input.token}`,
    "Client-Platform": "web",
    Origin: input.origin,
    Referer: `${input.origin}/`,
  };
  if (input.deviceUuid) headers["device-uuid"] = input.deviceUuid;

  let lastStatus = 0;
  let lastNote = "no response";
  for (const endpoint of GRAPHQL_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers, body: PROBE_BODY });
      lastStatus = res.status;
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        // non-JSON (e.g. an HTML error/challenge page)
      }
      const host = new URL(endpoint).host;
      if (res.ok && hasMe(json)) {
        return { ranAt: Date.now(), status: res.status, ok: true, note: `authenticated via ${host}` };
      }
      const gqlErr = firstGraphqlError(json);
      lastNote = gqlErr
        ? `${host}: HTTP ${res.status}, graphql error: ${gqlErr}`
        : `${host}: HTTP ${res.status}`;
      // 401/403 → try the other endpoint; 200-with-errors is definitive enough to stop.
      if (res.ok) return { ranAt: Date.now(), status: res.status, ok: false, note: lastNote };
    } catch (e) {
      lastStatus = 0;
      lastNote = `network error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { ranAt: Date.now(), status: lastStatus, ok: false, note: lastNote };
}

function hasMe(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const data = (json as Record<string, unknown>)["data"];
  if (typeof data !== "object" || data === null) return false;
  const me = (data as Record<string, unknown>)["me"];
  return typeof me === "object" && me !== null;
}

function firstGraphqlError(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const errors = (json as Record<string, unknown>)["errors"];
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const msg = (errors[0] as Record<string, unknown>)?.["message"];
  return typeof msg === "string" ? msg.slice(0, 160) : "unknown";
}
