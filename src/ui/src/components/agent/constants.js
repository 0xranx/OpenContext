export const INTENT_CONFIG = {
  create: { labelKey: 'agent.quickCreate', placeholderKey: 'agent.placeholderCreate' },
  iterate: { labelKey: 'agent.quickIterate', placeholderKey: 'agent.placeholderIterate' },
  search: { labelKey: 'agent.quickSearch', placeholderKey: 'agent.placeholderSearch' },
};

export const buildIntentConfig = (baseConfig, icons) =>
  Object.entries(baseConfig).reduce((acc, [id, config]) => {
    const icon = icons[id];
    acc[id] = icon ? { ...config, icon } : { ...config };
    return acc;
  }, {});

export const getIntentAction = (intentId, intentConfig) => {
  if (!intentId) return null;
  const config = intentConfig[intentId];
  if (!config) return null;
  return { id: intentId, ...config };
};

export const getIntentLabel = (t, intentId, intentConfig) => {
  if (!intentId) return t('agent.intentAuto');
  const action = getIntentAction(intentId, intentConfig);
  return action ? t(action.labelKey) : t('agent.intentAuto');
};

export const getIntentIcon = (intentId, intentConfig, fallbackIcon) => {
  const action = getIntentAction(intentId, intentConfig);
  return action?.icon || fallbackIcon;
};

export const getIntentPlaceholder = (t, intentId, intentConfig) => {
  if (!intentId) return t('agent.inputPlaceholder');
  const action = getIntentAction(intentId, intentConfig);
  const key = action?.placeholderKey;
  return key ? t(key) : t('agent.inputPlaceholder');
};

export const TOOL_STATUS_STYLES = {
  neutral: {
    badge: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    border: ['border-zinc-200 dark:border-zinc-800', 'border-zinc-300 dark:border-zinc-700'],
    bg: 'bg-zinc-50/40 hover:bg-zinc-50 dark:bg-zinc-900/30 dark:hover:bg-zinc-900/50',
    label: 'text-zinc-500',
  },
  success: {
    badge: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    border: ['border-emerald-100 dark:border-emerald-900/50', 'border-emerald-200 dark:border-emerald-800'],
    bg: 'bg-emerald-50/30 hover:bg-emerald-50/50 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/20',
    label: 'text-emerald-500',
  },
  error: {
    badge: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    border: ['border-red-100 dark:border-red-900/50', 'border-red-200 dark:border-red-800'],
    bg: 'bg-red-50/30 hover:bg-red-50/50 dark:bg-red-900/10 dark:hover:bg-red-900/20',
    label: 'text-red-500',
  },
};

export const DEFAULT_CODEX_MODELS = [
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
];

export const toModelOptions = (models) =>
  (Array.isArray(models) ? models : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => ({ value, label: value }));

export const mergeModelDefaults = (models, defaults) => {
  const base = Array.isArray(defaults) ? defaults : [];
  const extra = Array.isArray(models) ? models : [];
  const merged = [];
  const seen = new Set();
  base.forEach((item) => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    merged.push(value);
  });
  extra.forEach((item) => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    merged.push(value);
  });
  return merged;
};
