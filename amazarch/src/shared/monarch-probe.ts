// Live Monarch connectivity probe (M0) — a tiny authenticated `me` query.
// Auth transport lives in monarch-gql; see SPEC.md §R3 for why it's cookie-based.
import type { ProbeResult } from "./messages";
import { type MonarchAuth, gqlRequest } from "./monarch-gql";

export { readCookie } from "./monarch-gql";
export type { MonarchAuth } from "./monarch-gql";

const PROBE_DOC = {
  operationName: "AmazarchProbe",
  query: "query AmazarchProbe { me { id } }",
  variables: {},
};

export async function probeMonarchApi(auth: MonarchAuth): Promise<ProbeResult> {
  const res = await gqlRequest(auth, PROBE_DOC);
  const me = hasMe(res.data);
  return {
    ranAt: Date.now(),
    status: res.status,
    ok: res.ok && me,
    note: res.ok && me ? `authenticated (${res.method}) via ${res.host}` : res.note,
  };
}

function hasMe(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const me = (data as Record<string, unknown>)["me"];
  return typeof me === "object" && me !== null;
}
