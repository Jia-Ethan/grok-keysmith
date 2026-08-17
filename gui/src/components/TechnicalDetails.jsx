import React from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * 默认折叠的技术详情：原始 CLI 输出、SHA、token 等诊断内容只在这里出现。
 * props: label（可选，默认 common.technicalDetails）、children
 */
export function TechnicalDetails({ label, children }) {
  const { t } = useTranslation();
  return (
    <Collapsible className="mt-3">
      <CollapsibleTrigger className="cursor-pointer text-xs font-medium text-accent hover:text-accent-hover">
        {label || t("common.technicalDetails")}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
