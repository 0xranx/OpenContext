import {
  ChevronDownIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

export function IntentSelector({
  activeIntent,
  intentLabel,
  IntentIcon,
  showIntentMenu,
  setShowIntentMenu,
  handleQuickAction,
  t,
  intentMenuRef,
  quickActions,
}) {
  return (
    <div className="flex-shrink-0 relative" ref={intentMenuRef}>
      <button
        type="button"
        onClick={() => setShowIntentMenu(!showIntentMenu)}
        className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-[11px] font-medium transition-all select-none border ${
          activeIntent
            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100 shadow-sm'
            : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
        }`}
        title={t('agent.quickActions')}
      >
        <IntentIcon className="w-3.5 h-3.5" />
        <span>{intentLabel}</span>
        <ChevronDownIcon className={`w-3 h-3 opacity-50 ${activeIntent ? 'text-white/70 dark:text-black/70' : ''}`} />
      </button>

      {showIntentMenu && (
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 origin-bottom-left flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (activeIntent) handleQuickAction(activeIntent);
              setShowIntentMenu(false);
            }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left ${
              !activeIntent
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            }`}
          >
            <SparklesIcon className="w-3.5 h-3.5" />
            <span>{t('agent.intentAuto')}</span>
            {!activeIntent && <CheckCircleIcon className="w-3 h-3 ml-auto text-zinc-400" />}
          </button>
          <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-0.5 mx-1" />
          {quickActions.map((action) => {
            const isActive = activeIntent === action.id;
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  handleQuickAction(action.id);
                  setShowIntentMenu(false);
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  isActive
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t(action.labelKey)}</span>
                {isActive && <CheckCircleIcon className="w-3 h-3 ml-auto text-zinc-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
