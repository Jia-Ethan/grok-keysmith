const KEY = "grok-keysmith-gui:settings";

const defaults = {
  cliPath: "",
  grokBin: "",
  defaultGrokDir: "",
  lang: "zh-CN",
  theme: "system",
  showAdvancedTools: false,
};

let cache = null;
const listeners = new Set();

export function normalizeCliPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSettings(settings) {
  return {
    ...settings,
    cliPath: normalizeCliPath(settings.cliPath),
    grokBin: normalizeCliPath(settings.grokBin),
    defaultGrokDir: normalizeCliPath(settings.defaultGrokDir),
    showAdvancedTools: settings.showAdvancedTools === true,
  };
}

export function getSettings() {
  if (!cache) {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        stored = parsed;
      }
    } catch {}
    cache = normalizeSettings({ ...defaults, ...stored });
  }
  return { ...cache };
}

export function saveSettings(patch) {
  cache = normalizeSettings({ ...getSettings(), ...patch });
  localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((fn) => fn(getSettings()));
  return getSettings();
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
