// 将 CLI 的原始英文诊断与路径片段翻译为面向用户的中文文案。
// 原始输出只在默认折叠的“技术详情”中保留。

const RAW_MESSAGE_PATTERNS = [
  {
    pattern: /compat values aligned/i,
    key: "raw.configRepairable",
  },
  {
    pattern: /content does not match managed after-state/i,
    key: "raw.configChanged",
  },
  {
    pattern: /unexpected content/i,
    key: "raw.unexpectedContent",
  },
  {
    pattern: /interrupted|residual|journal/i,
    key: "raw.residue",
  },
  {
    pattern: /backup.*(?:missing|abnormal|integrity)|previous manifest backup/i,
    key: "raw.backupIssue",
  },
  {
    pattern: /hook/i,
    key: "raw.hookIssue",
  },
  {
    pattern: /(?:rule|config|manifest|grok-dir|hooks directory|managed .* node).*\b(?:node|directory|is)\b/i,
    key: "raw.nodeIssue",
  },
];

export function translateRawMessage(value, t) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  for (const { pattern, key } of RAW_MESSAGE_PATTERNS) {
    if (pattern.test(text)) return t(key);
  }
  return t("raw.otherIssue");
}

export function translateRawList(values, t) {
  return [...new Set((values || []).map((value) => translateRawMessage(value, t)).filter(Boolean))];
}
