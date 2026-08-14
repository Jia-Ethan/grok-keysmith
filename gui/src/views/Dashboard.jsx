import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Terminal, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { fetchStatus, grokInspect, isTauriMissing, readManifest } from "@/lib/api";
import { useAppState } from "@/hooks/useAppState";
import { setLastStatus, setView } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/FadeIn";
import { buildInfo } from "@/lib/buildInfo";
import { fingerprintShort } from "@/lib/contract";
import { cn } from "@/lib/utils";

const STATE_VARIANT = {
  "active-aligned": "green",
  inactive: "yellow",
  drift: "yellow",
  conflict: "red",
  "recovery-required": "red",
  "not-installed": "gray",
};

export function Dashboard() {
  const { t } = useTranslation();
  const { cliInfo, lastStatus } = useAppState();
  const [status, setStatus] = React.useState(lastStatus);
  const [inspect, setInspect] = React.useState(null);
  const [manifest, setManifest] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await fetchStatus();
      setStatus(envelope);
      setLastStatus(envelope);
      const grokDir = envelope.target?.grok_dir;
      if (grokDir) {
        try {
          setManifest(await readManifest(grokDir));
        } catch {
          setManifest(null);
        }
      }
      try {
        const inspectOut = await grokInspect();
        setInspect(inspectOut.stdout ? JSON.parse(inspectOut.stdout) : inspectOut);
      } catch {
        setInspect(null);
      }
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      toast.error(t("dash.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fixture") === "1") {
      const envelope = {
        schema: "grok-keysmith.envelope.v1",
        target: { grok_dir: "/tmp/fixture/.grok" },
        result: {
          state: "active-aligned",
          nodes: {
            rule: { kind: "regular", fingerprint: { sha256: "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898", size: 8391 } },
            config: { kind: "regular" },
            manifest: { kind: "regular" },
          },
          compat: { present: true, matches_expected: true },
          hooks: { active: [], disabled: [], owned_disabled: [], external_disabled: [] },
          manifest: { deployment_id: "fixture", prompt_sha256: "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898" },
          backups: [],
          residue: [],
          drift: [],
          conflicts: [],
        },
      };
      setStatus(envelope);
      setLastStatus(envelope);
      return;
    }
    if (cliInfo.checked && cliInfo.path && !status) refresh();
  }, [cliInfo.checked, cliInfo.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = status?.result;
  const state = result?.state || "not-installed";

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <FadeIn>
          <h1 className="text-2xl font-semibold tracking-tight">{t("dash.title")}</h1>
        </FadeIn>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading || !cliInfo.path}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          {t("dash.refresh")}
        </Button>
      </div>

      {!cliInfo.checked || loading ? (
        <p className="text-sm text-muted-foreground"><span className="spinner mr-2" />...</p>
      ) : null}

      {cliInfo.checked && !cliInfo.path && (
        <div className="card-glass p-8 text-center">
          <Terminal className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-4 text-sm">{t("dash.noCli")}</p>
          <Button className="mt-5" onClick={() => setView("settings")}>{t("dash.noCliAction")}</Button>
        </div>
      )}

      {error && (
        <div className="card-glass border-danger/40 p-6" role="alert">
          <div className="flex items-center gap-2 text-sm font-semibold text-danger">
            <AlertTriangle className="size-4" />
            {t("dash.error")}
          </div>
          <pre className="log-block mt-3">{String(error.message || error)}</pre>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="card-glass p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATE_VARIANT[state] || "gray"}>{t(`state.${state}`)}</Badge>
              <Badge variant="outline">Desktop {buildInfo.desktopVersion}</Badge>
              <Badge variant="outline">{cliInfo.version || "CLI"}</Badge>
              {cliInfo.runtime ? <Badge variant="outline">{t(`runtime.${cliInfo.runtime}`)}</Badge> : null}
              <Badge variant="outline">{buildInfo.channel}</Badge>
            </div>
            <dl className="mt-4 grid gap-2 text-sm">
              <Row label="prompt" value={result.manifest?.prompt_sha256 || result.nodes?.rule?.fingerprint?.sha256 || "—"} />
              <Row label="source commit" value={buildInfo.sourceCommit || "development"} />
              <Row label="grok dir" value={status.target?.grok_dir || "—"} />
            </dl>
          </div>

          <div className="card-glass p-5">
            <h2 className="text-sm font-semibold">{t("dash.managed")}</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <Row label={t("dash.rule")} value={`${result.nodes?.rule?.kind || "—"} ${fingerprintShort(result.nodes?.rule?.fingerprint)}`} />
              <Row label={t("dash.compat")} value={result.compat?.present ? "present" : "absent"} />
              <Row label={t("dash.hooks")} value={`active ${result.hooks?.active?.length || 0} / disabled ${result.hooks?.disabled?.length || 0}`} />
              <Row label={t("dash.manifest")} value={result.manifest?.deployment_id || result.nodes?.manifest?.kind || "—"} />
              <Row label={t("dash.backups")} value={(result.backups || []).join(", ") || "—"} />
              <Row label={t("dash.residue")} value={(result.residue || []).join(", ") || "—"} />
              <Row label="drift" value={(result.drift || []).join("; ") || "—"} />
              <Row label="conflict" value={(result.conflicts || []).join("; ") || "—"} />
            </dl>
            {state === "recovery-required" && (
              <Button className="mt-4" variant="warning" onClick={() => setView("manage")}>
                {t("dash.recoverAction")}
              </Button>
            )}
          </div>

          <div className="card-glass p-5">
            <h2 className="text-sm font-semibold">{t("dash.inspect")}</h2>
            {inspect ? (
              <pre className="log-block mt-3">{JSON.stringify({
                grokVersion: inspect.grokVersion,
                channel: inspect.channel,
                projectInstructions: inspect.projectInstructions,
                externalCompat: inspect.externalCompat,
                hooks: inspect.hooks,
              }, null, 2)}</pre>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">—</p>
            )}
          </div>

          {manifest && (
            <div className="card-glass p-5">
              <h2 className="text-sm font-semibold">{t("dash.manifest")}</h2>
              <pre className="log-block mt-3">{JSON.stringify(manifest, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value}</dd>
    </div>
  );
}
