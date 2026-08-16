import { describe, expect, it } from "vitest";
import { translateRawList, translateRawMessage } from "./statusText.js";

const t = (key) => ({
  "raw.configChanged": "Grok 配置已发生变化",
  "raw.unexpectedContent": "检测到未预期的内容",
  "raw.residue": "存在中断操作残留",
}[key] || key);

describe("statusText 原始诊断翻译", () => {
  it("翻译 config drift 为用户文案", () => {
    expect(translateRawMessage("config content does not match managed after-state", t))
      .toBe("Grok 配置已发生变化");
  });

  it("翻译 rule drift 为用户文案", () => {
    expect(translateRawMessage("rule content does not match managed after-state", t))
      .toBe("Grok 配置已发生变化");
  });

  it("翻译残留类诊断", () => {
    expect(translateRawMessage("interrupted journals remain", t)).toBe("存在中断操作残留");
  });

  it("未知诊断保留原文", () => {
    expect(translateRawMessage("some unknown failure", t)).toBe("some unknown failure");
  });

  it("空值返回空字符串", () => {
    expect(translateRawMessage("", t)).toBe("");
    expect(translateRawMessage(null, t)).toBe("");
  });

  it("列表翻译过滤空值", () => {
    expect(translateRawList(["config content does not match managed after-state", "", null], t))
      .toEqual(["Grok 配置已发生变化"]);
  });
});
