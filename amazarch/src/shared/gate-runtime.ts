// Runtime composition of the write gate: load the license + remote config and
// resolve them against the running version. Kept separate from write-gate.ts so
// that module stays pure (and independently unit-tested); this one just wires
// the async loaders to the pure evaluator.
import { isLicensingConfigured } from "./config";
import { evaluateEntitlement, loadLicense } from "./licensing";
import { evaluateRemoteConfig, refreshRemoteConfig } from "./remote-config";
import { evaluateWriteGate, type WriteGate } from "./write-gate";

export async function resolveWriteGate(version: string, now: number = Date.now()): Promise<WriteGate> {
  const [license, remote] = await Promise.all([loadLicense(), refreshRemoteConfig(now)]);
  return evaluateWriteGate({
    licensingConfigured: isLicensingConfigured(),
    entitlement: evaluateEntitlement(license, now),
    remote: evaluateRemoteConfig(remote, version),
  });
}
