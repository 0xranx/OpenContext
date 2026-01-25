import { useState, useRef, useEffect } from 'react';
import { PlusIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

function ModelInput({ value, onChange, options, placeholder, label }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-xs font-medium text-zinc-500 mb-2 px-1 text-center">
        {label}
      </label>
      <div className="relative group">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          className="w-full rounded-xl border border-zinc-200 pl-4 pr-10 py-3 text-xs text-zinc-900 focus:ring-2 focus:ring-black/5 focus:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 dark:focus:ring-white/10 dark:focus:border-zinc-600 placeholder-zinc-400 dark:placeholder-zinc-600 transition-all outline-none bg-white text-center shadow-sm group-hover:border-zinc-300 dark:group-hover:border-zinc-600"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && options.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden z-20 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
          <div className="p-1 space-y-0.5">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                  value === opt.value
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 font-medium'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {value === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentSessionSetup({
  t,
  agentPresets,
  selectedAgentPreset,
  setSelectedAgentPreset,
  modelOptions,
  modelInput,
  setModelInput,
  modelPlaceholder,
  modelHint,
  customAgentLabel,
  setCustomAgentLabel,
  onCreateSession,
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 bg-white dark:bg-zinc-900">
      <div className="max-w-[320px] mx-auto">
        <div className="text-center mb-8">
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">
            {t('agent.selectAgentTitle')}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('agent.selectAgentSubtitle')}
          </div>
        </div>
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            {agentPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedAgentPreset(preset.id)}
                className={`relative p-3 rounded-2xl border text-left transition-all duration-200 flex flex-col items-center gap-3 group w-full ${
                  selectedAgentPreset === preset.id
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 shadow-lg scale-[1.02] ring-2 ring-zinc-900/10 dark:ring-zinc-100/10'
                    : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    selectedAgentPreset === preset.id
                      ? 'bg-white/20 text-white dark:text-zinc-900 dark:bg-zinc-900/10'
                      : 'bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200/50 dark:bg-zinc-800 dark:text-zinc-400 dark:group-hover:bg-zinc-700'
                  }`}
                >
                  {preset.logo ? (
                    <img src={preset.logo} alt="" className="w-4 h-4 object-contain" />
                  ) : (
                    <PlusIcon className="w-4 h-4" />
                  )}
                </div>
                <span className="text-[11px] font-semibold truncate w-full text-center leading-tight">
                  {preset.labelKey ? t(preset.labelKey) : preset.label}
                </span>
              </button>
            ))}
          </div>

          <div className="pt-2">
            <ModelInput
              value={modelInput}
              onChange={setModelInput}
              options={modelOptions}
              placeholder={modelPlaceholder}
              label={t('agent.modelLabel')}
            />
            <div className="text-[10px] text-zinc-400 mt-2 px-1 text-center">{modelHint}</div>
          </div>

          {selectedAgentPreset === 'custom' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-200 pt-2">
              <label className="block text-xs font-medium text-zinc-500 mb-2 px-1">
                {t('agent.customAgentLabel')}
              </label>
              <input
                type="text"
                value={customAgentLabel}
                onChange={(event) => setCustomAgentLabel(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-xs text-zinc-900 focus:ring-2 focus:ring-black/5 focus:border-zinc-300 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:ring-white/10 dark:focus:border-zinc-700 transition-all outline-none"
              />
            </div>
          )}

          <div className="pt-4">
            <button
              type="button"
              className="w-full px-4 py-3 text-sm font-semibold text-white bg-zinc-900 rounded-xl hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-all shadow-md hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
              onClick={onCreateSession}
            >
              <span>{t('agent.startSession')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
