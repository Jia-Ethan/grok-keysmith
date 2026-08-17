// 一级导航与视图解析的单一真源。
// Sidebar 与 App 都从这里取导航项与视图归一化结果，避免两套门禁逻辑漂移。

export const BASE_NAV = ["dashboard", "deploy", "manage"];
export const ADVANCED_NAV_KEY = "advanced";
export const TAIL_NAV = ["settings"];
export const LEGACY_ADVANCED_VIEWS = ["run", "test"];

function normalizeAdvancedTab(value) {
  return LEGACY_ADVANCED_VIEWS.includes(value) ? value : null;
}

/**
 * 解析启动深链。显式 tab 优先；旧的 view=run/test 则同时决定高级工具标签。
 */
export function resolveInitialNavigation(params) {
  const requestedView = params.get("view");
  const legacyTab = normalizeAdvancedTab(requestedView);
  return {
    view: legacyTab ? ADVANCED_NAV_KEY : requestedView,
    advancedTab: normalizeAdvancedTab(params.get("tab")) || legacyTab,
  };
}

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
