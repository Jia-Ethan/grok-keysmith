import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster, toast } from "sonner";
import i18n from "./i18n";
import { getSettings, onSettingsChange } from "@/lib/settings";
import { useAppState } from "@/hooks/useAppState";
import { beginCliCheck, completeCliCheck, getState, setView } from "@/lib/store";
import { resolveCli, isTauriMissing } from "@/lib/api";
import { installWindowCloseLifecycle } from "@/lib/windowLifecycle";
import { AmbientBg } from "@/components/AmbientBg";
import { Sidebar } from "@/components/Sidebar";
import { Dashboard } from "@/views/Dashboard";
import { Deploy } from "@/views/Deploy";
import { AdvancedTools } from "@/views/AdvancedTools";
import { Manage } from "@/views/Manage";
import { SettingsView } from "@/views/SettingsView";
import {
  resolveInitialNavigation,
  resolveView,
  LEGACY_ADVANCED_VIEWS,
} from "@/lib/navigation";

function useTheme() {
  const [theme, setTheme] = React.useState(() => getSettings().theme);
  React.useEffect(
    () =>
      onSettingsChange((s) => {
        setTheme(s.theme);
        if (s.lang !== i18n.language) i18n.changeLanguage(s.lang);
      }),
    [],
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

export default function App() {
  const { view } = useAppState();
  useTheme();
  const initialNavigation = React.useMemo(
    () => resolveInitialNavigation(new URLSearchParams(window.location.search)),
    [],
  );

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (initialNavigation.view) setView(initialNavigation.view);
    const theme = params.get("theme");
    if (theme) document.documentElement.classList.toggle("dark", theme === "dark");
    if (params.get("fixture") === "1") {
      completeCliCheck(beginCliCheck(), {
        path: "/tmp/fixture/grok-keysmith.py",
        version: "grok-keysmith 0.4.0",
        runtime: "python",
        error: null,
        checked: true,
      });
    }
  }, [initialNavigation]);

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("fixture") === "1") return;
    const generation = beginCliCheck();
    (async () => {
      try {
        completeCliCheck(generation, {
          ...(await resolveCli(getSettings().cliPath)),
          error: null,
          checked: true,
        });
      } catch (err) {
        if (isTauriMissing(err)) return;
        completeCliCheck(generation, {
          path: null,
          version: "",
          runtime: "",
          error: err?.message || String(err),
          checked: true,
        });
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    const appWindow = getCurrentWindow();
    const lifecycle = installWindowCloseLifecycle({
      appWindow,
      onExitQueued: () => toast.warning(i18n.t("manage.exitQueued")),
      onError: ({ phase, error }) => {
        console.error(`Window close lifecycle ${phase} failed`, error);
        toast.error(i18n.t(
          phase === "registration" ? "manage.exitGuardFailed" : "manage.exitFailed",
        ));
      },
    });
    return lifecycle.dispose;
  }, []);

  const [showAdvanced, setShowAdvanced] = React.useState(() => getSettings().showAdvancedTools);

  React.useEffect(
    () => onSettingsChange((settings) => {
      setShowAdvanced(settings.showAdvancedTools);
      // 关闭高级工具时，如果正位于高级工具页或旧的 run/test 深链，安全返回状态总览。
      if (!settings.showAdvancedTools
        && ["advanced", ...LEGACY_ADVANCED_VIEWS].includes(getState().view)) {
        setView("dashboard");
      }
    }),
    [],
  );

  const views = {
    dashboard: <Dashboard />,
    deploy: <Deploy />,
    advanced: <AdvancedTools initialTab={initialNavigation.advancedTab} />,
    manage: <Manage />,
    settings: <SettingsView />,
  };
  const resolvedView = resolveView(view, showAdvanced);

  return (
    <div className="flex h-full">
      <AmbientBg />
      <Sidebar />
      <main className="relative flex-1 overflow-y-auto" key={view}>
        <div className="mx-auto max-w-[880px] px-6 py-8 md:px-10">
          {views[resolvedView] ?? views.dashboard}
        </div>
      </main>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          },
        }}
      />
    </div>
  );
}
