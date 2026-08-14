export const ENVELOPE_SCHEMA = "grok-keysmith.envelope.v1";

export function parseEnvelope(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("empty CLI stdout");
  const data = JSON.parse(text);
  if (data?.schema !== ENVELOPE_SCHEMA) {
    throw new Error("unsupported CLI envelope schema");
  }
  return data;
}

export function gatePreview(envelope) {
  const blockers = envelope?.plan?.blockers || [];
  const diagnostics = envelope?.diagnostics || [];
  const ok =
    Boolean(envelope?.ok)
    && envelope?.preview === true
    && envelope?.apply === false
    && blockers.length === 0;
  return {
    ok,
    blockers,
    diagnostics,
    reason: ok ? "" : (blockers[0] || diagnostics[0] || "preview failed"),
  };
}

export function fingerprintShort(fp) {
  if (!fp?.sha256) return "";
  return `${fp.sha256.slice(0, 12)}…`;
}
