// 一级导航与视图解析的单一真源。
// Sidebar 与 App 都从这里取导航项与视图归一化结果，避免两套门禁逻辑漂移。

export const BASE_NAV = ["dashboard", "deploy", "manage"];
export const ADVANCED_NAV_KEY = "advanced";
export const TAIL_NAV = ["settings"];
export const LEGACY_ADVANCED_VIEWS = ["run", "test"];

export function buildNav(showAdvancedTools) {
  return showAdvancedTools
    ? [...BASE_NAV, ADVANCED_NAV_KEY, ...TAIL_NAV]
    : [...BASE_NAV, ...TAIL_NAV];
}

/**
 * 归一化视图：
 * - 旧的 run/test 深链映射到 advanced；
 * - 高级工具关闭时，advanced 与旧深链一律安全返回 dashboard。
 */
export function resolveView(view, showAdvancedTools) {
  if (LEGACY_ADVANCED_VIEWS.includes(view)) {
    return showAdvancedTools ? ADVANCED_NAV_KEY : "dashboard";
  }
  if (view === ADVANCED_NAV_KEY && !showAdvancedTools) return "dashboard";
  return view;
}
