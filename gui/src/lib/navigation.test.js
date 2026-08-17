// 页面级回归：高级工具导航门禁。
// 一级导航默认只有状态总览/部署/管理/设置；开启设置开关后只增加一个“高级工具”入口；
// 关闭开关时若正位于高级工具页（或旧的 run/test 深链）安全返回状态总览。
import { describe, expect, it } from "vitest";
import {
  buildNav,
  resolveInitialNavigation,
  resolveView,
  LEGACY_ADVANCED_VIEWS,
} from "./navigation.js";

describe("一级导航与高级工具门禁", () => {
  it("默认只显示状态总览、部署、管理、设置", () => {
    expect(buildNav(false)).toEqual(["dashboard", "deploy", "manage", "settings"]);
  });

  it("开启后只增加一个高级工具入口", () => {
    const nav = buildNav(true);
    expect(nav).toEqual(["dashboard", "deploy", "manage", "advanced", "settings"]);
    expect(nav.filter((key) => key === "advanced")).toHaveLength(1);
    expect(nav).not.toContain("run");
    expect(nav).not.toContain("test");
  });

  it("旧的 run/test 深链映射到高级工具", () => {
    expect(resolveView("run", true)).toBe("advanced");
    expect(resolveView("test", true)).toBe("advanced");
  });

  it("旧深链进入高级工具的对应标签", () => {
    expect(resolveInitialNavigation(new URLSearchParams("view=run"))).toEqual({
      view: "advanced",
      advancedTab: "run",
    });
    expect(resolveInitialNavigation(new URLSearchParams("view=test"))).toEqual({
      view: "advanced",
      advancedTab: "test",
    });
  });

  it("显式 tab 优先于旧 view，且忽略无效 tab", () => {
    expect(resolveInitialNavigation(new URLSearchParams("view=test&tab=run"))).toEqual({
      view: "advanced",
      advancedTab: "run",
    });
    expect(resolveInitialNavigation(new URLSearchParams("view=test&tab=unknown"))).toEqual({
      view: "advanced",
      advancedTab: "test",
    });
  });

  it("关闭开关时高级工具页与旧深链安全返回状态总览", () => {
    expect(resolveView("advanced", false)).toBe("dashboard");
    for (const legacy of LEGACY_ADVANCED_VIEWS) {
      expect(resolveView(legacy, false)).toBe("dashboard");
    }
  });

  it("普通视图不受开关影响", () => {
    expect(resolveView("manage", false)).toBe("manage");
    expect(resolveView("advanced", true)).toBe("advanced");
  });
});
