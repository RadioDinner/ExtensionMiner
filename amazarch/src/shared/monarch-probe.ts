// Live Monarch GraphQL connectivity probe.
//
// Monarch's web app authenticates its API with the browser SESSION COOKIE plus
// a Django-style CSRF token (there is no bearer token in localStorage anymore —
// see SPEC.md §R3 update). So the reliable path is a *credentialed* request
// made from the Monarch page's own context (the content script), which carries
// the session cookie automatically; we echo the readable `csrftoken` cookie in
// the X-CSRFToken header. A bearer-token attempt is kept as a fallback in case
// a given account still exposes one.
//
// Runs in the content script so the request originates from app.monarch.com
// (correct Origin/Referer for CSRF) and shares the page's cookie jar. The
// extension's host_permissions for api.monarch.com let it bypass CORS in Firefox.
import type { ProbeResult } from "./messages";

const ENDPOINTS = ["https://api.monarch.com/graphql", "https://api.monarchmoney.com/graphql"];

const PROBE_BODY = JSON.stringify({
  operationName: "AmazarchProbe",
  query: "query AmazarchProbe { me { id } }",
  variables: {},
});

export interface ProbeOptions {
  origin: string;
  csrftoken: string | null;
  deviceUuid: string | null;
  token: string | null; // optional bearer token, if one was found
}

type Method = "cookie" | "bearer";

export async function probeMonarchApi(opts: ProbeOptions): Promise<ProbeResult> {
  const methods: Method[] = [];
  if (opts.csrftoken) methods.push("cookie");
  if (opts.token) methods.push("bearer");
  if (methods.length === 0) methods.push("cookie"); // try cookie even without a readable csrftoken

  let last: ProbeResult = { ranAt: Date.now(), status: 0, ok: false, note: "no attempt made" };

  for (const method of methods) {
    for (const endpoint of ENDPOINTS) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Client-Platform": "web",
      };
      if (opts.deviceUuid) headers["device-uuid"] = opts.deviceUuid;
      let credentials: RequestCredentials = "omit";
      if (method === "cookie") {
        credentials = "include";
        if (opts.csrftoken) headers["X-CSRFToken"] = opts.csrftoken;
      } else {
        headers["Authorization"] = `Token ${opts.token}`;
      }

      const host = new URL(endpoint).host;
      try {
        const res = await fetch(endpoint, { method: "POST", headers, body: PROBE_BODY, credentials });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          // non-JSON error/challenge page
        }
        if (res.ok && hasMe(json)) {
          return { ranAt: Date.now(), status: res.status, ok: true, note: `authenticated (${method}) via ${host}` };
        }
        const gqlErr = firstGraphqlError(json);
        last = {
          ranAt: Date.now(),
          status: res.status,
          ok: false,
          note: gqlErr
            ? `${method}@${host}: HTTP ${res.status}, graphql: ${gqlErr}`
            : `${method}@${host}: HTTP ${res.status}`,
        };
      } catch (e) {
        last = {
          ranAt: Date.now(),
          status: 0,
          ok: false,
          note: `${method}@${host}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
  }
  return last;
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

/** Read a single cookie value from a document.cookie string. */
export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}
