import React from "react";
import { useTranslation } from "react-i18next";
import { FadeIn } from "@/components/FadeIn";
import { RunView } from "@/views/RunView";
import { TestView } from "@/views/TestView";
import { cn } from "@/lib/utils";

/**
 * 高级工具：单一一级入口，内部以标签承载现有“运行”和“测试”。
 * 执行、流式输出、取消、恢复与报告逻辑完全复用 RunView/TestView。
 * 初始标签可通过 ?tab=run|test 深链指定（兼容旧的 run/test 入口）。
 */
export function AdvancedTools({ initialTab = "run" }) {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState(initialTab === "test" ? "test" : "run");

  return (
    <div>
      <FadeIn>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("advanced.title")}</h1>
      </FadeIn>
      <div className="mb-4 flex gap-2" role="tablist" aria-label={t("advanced.title")}>
        {[
          { key: "run", label: t("advanced.runTab") },
          { key: "test", label: t("advanced.testTab") },
        ].map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            data-tab={key}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "cursor-pointer rounded-[10px] px-3 py-1.5 text-sm transition-colors",
              tab === key
                ? "bg-accent-soft font-medium text-accent"
                : "text-secondary-foreground hover:bg-elevated hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "run" ? <RunView /> : <TestView />}
    </div>
  );
}
