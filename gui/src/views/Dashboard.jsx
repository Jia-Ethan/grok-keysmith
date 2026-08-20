import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Terminal, AlertTriangle, Copy, Rocket, Wrench, Eye } from "lucide-react";
import { toast } from "sonner";
import { fetchStatus, isTauriMissing, resolveCli } from "@/lib/api";
import { useAppState } from "@/hooks/useAppState";
import {
  beginCliCheck,
  completeCliCheck,
  setLastStatus,
  setView,
} from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/FadeIn";
import { TechnicalDetails } from "@/components/TechnicalDetails";
import { cn } from "@/lib/utils";
import { getSettings } from "@/lib/settings";
import { presentDashboard } from "@/lib/dashboardPresentation";

const STATE_VARIANT = {
  "active-aligned": "green",
  inactive: "yellow",
  drift: "yellow",
  conflict: "red",
  "recovery-required": "red",
  "not-installed": "gray",
};

const ACTION_META = {
  recover: { labelKey: "dash.recoverAction", variant: "warning", Icon: Wrench },
  reconcile: { labelKey: "dash.reconcileAction", variant: "default", Icon: Wrench },
  issues: { labelKey: "dash.inspectIssues", variant: "outline", Icon: Eye },
  deploy: { labelKey: "dash.startDeploy", variant: "default", Icon: Rocket },
};

// fixture=1 下 Dashboard 使用较重的数据；fixtureState 可切换异常状态。
const FIXTURE_BACKUPS = Array.from(
  { length: 36 },
  (_, index) => `grok-backup-202608${String(index + 1).padStart(2, "0")}-1200-abcdef0123456789.tar.gz`,
);

const FIXTURE_ENVELOPE = {
  schema: "grok-keysmith.envelope.v1",
  target: {
    grok_dir:
      "/tmp/fixture/users/someone-with-a-very-long-home-directory-name/Library/Application Support/Grok/.grok",
  },
  result: {
    state: "active-aligned",
    nodes: {
      rule: {
        kind: "regular",
        fingerprint: {
          sha256: "024e0a217cd8dab39e8109160dc8890f196d9a4584fb092928a87c553b3174b2",
          size: 10627,
        },
      },
      config: { kind: "regular" },
      manifest: { kind: "regular" },
    },
    compat: { present: true, matches_expected: true },
    hooks: { active: [], disabled: [], owned_disabled: [], external_disabled: [] },
    manifest: {
      deployment_id: "fixture-deployment-0001",
      prompt_sha256: "024e0a217cd8dab39e8109160dc8890f196d9a4584fb092928a87c553b3174b2",
    },
    backups: FIXTURE_BACKUPS,
    residue: [],
    drift: [],
    conflicts: [],
  },
};

function fixtureEnvelope(state) {
  const next = structuredClone(FIXTURE_ENVELOPE);
  next.result.state = state;
  if (state === "drift") next.result.drift = ["config content does not match managed after-state"];
  if (state === "conflict") next.result.conflicts = ["managed rule node is directory"];
  if (state === "recovery-required") next.result.residue = [".grok-keysmith-transaction-fixture"];
  if (state === "inactive") next.result.compat = { present: false, matches_expected: false };
  if (state === "not-installed") {
    next.result.nodes.rule = { kind: "missing", fingerprint: null };
    next.result.nodes.config = { kind: "missing" };
    next.result.nodes.manifest = { kind: "missing" };
    next.result.compat = { present: false, matches_expected: false };
    next.result.manifest = null;
  }
  return next;
}

export function Dashboard() {
  const { t } = useTranslation();
  const { cliInfo, lastStatus } = useAppState();
  const [status, setStatus] = React.useState(lastStatus);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 首页刷新只获取 status，不再附带 inspect 与 manifest。
      const envelope = await fetchStatus();
      setStatus(envelope);
      setLastStatus(envelope);
    } catch (err) {
      if (isTauriMissing(err)) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      toast.error(t("dash.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const retryCli = React.useCallback(async () => {
    const generation = beginCliCheck();
    try {
      completeCliCheck(generation, {
        ...(await resolveCli(getSettings().cliPath)),
        error: null,
        checked: true,
      });
    } catch (err) {
      completeCliCheck(generation, {
        path: null,
        version: "",
        runtime: "",
        error: err?.message || String(err),
        checked: true,
      });
    }
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fixture") === "1") {
      const envelope = fixtureEnvelope(params.get("fixtureState") || "active-aligned");
      setStatus(envelope);
      setLastStatus(envelope);
      return;
    }
    if (cliInfo.checked && cliInfo.path && !status) refresh();
  }, [cliInfo.checked, cliInfo.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = status?.result;
  const state = result?.state || "not-installed";
  const model = result ? presentDashboard({ state, grokDir: status?.target?.grok_dir || "", result }, t) : null;
  const action = model?.primaryAction ? ACTION_META[model.primaryAction.key] : null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
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
          {cliInfo.error ? (
            <AlertTriangle className="mx-auto size-10 text-danger" aria-hidden="true" />
          ) : (
            <Terminal className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
          )}
          <p className="mt-4 text-sm">{t(cliInfo.error ? "dash.cliCheckFailed" : "dash.noCli")}</p>
          {cliInfo.error ? (
            <TechnicalDetails>
              <pre className="log-block mt-2 text-left" role="alert">{cliInfo.error}</pre>
            </TechnicalDetails>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={retryCli}>{t("dash.retryCli")}</Button>
            <Button variant="outline" onClick={() => setView("settings")}>{t("dash.noCliAction")}</Button>
          </div>
        </div>
      )}

      {error && (
        <div className="card-glass border-danger/40 p-6" role="alert">
          <div className="flex items-center gap-2 text-sm font-semibold text-danger">
            <AlertTriangle className="size-4" />
            {t("dash.error")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("dash.errorHint")}</p>
          <TechnicalDetails>
            <pre className="log-block mt-2">{String(error.message || error)}</pre>
          </TechnicalDetails>
        </div>
      )}

      {model && (
        <div className="flex flex-col gap-4">
          <div className="card-glass p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant={STATE_VARIANT[model.state] || "gray"}>{t(`state.${model.state}`)}</Badge>
              {action && (
                <Button
                  variant={action.variant}
                  size="sm"
                  onClick={() => setView(model.primaryAction.view)}
                >
                  <action.Icon className="size-3.5" />
                  {t(action.labelKey)}
                </Button>
              )}
            </div>
            <p className="mt-3 text-sm">{t(`dash.summary.${model.summaryKey || model.state}`)}</p>
            {model.grokDir ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">{t("dash.grokDir")}</span>
                <code className="min-w-0 flex-1 truncate font-mono" title={model.grokDir}>{model.grokDir}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("common.copy")}
                  onClick={() => navigator.clipboard?.writeText(model.grokDir)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </div>

          {model.health.length > 0 ? <div className="card-glass p-5">
            <h2 className="text-sm font-semibold">{t("dash.health")}</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {model.health.map((row) => (
                <li key={row.key} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      row.ok ? "bg-[var(--ok)]" : "bg-[var(--warn)]",
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span>{t(`dash.${row.key === "config" ? "grokConfig" : row.key}`)}</span>
                    {row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
            {model.backupsSummary ? (
              <p className="mt-3 text-xs text-muted-foreground">{model.backupsSummary}</p>
            ) : null}
            <TechnicalDetails>
              <pre className="log-block mt-2">{JSON.stringify(model.technical, null, 2)}</pre>
            </TechnicalDetails>
          </div> : null}
        </div>
      )}
    </div>
  );
}
