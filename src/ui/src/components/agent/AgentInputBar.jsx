import { ArrowUpIcon } from '@heroicons/react/24/outline';
import { IntentSelector } from './IntentSelector';
import { ModelSelector } from '../ModelSelector';

export function AgentInputBar({
  inputRef,
  inputValue,
  setInputValue,
  inputPlaceholder,
  isInputReady,
  isGenerating,
  isComposing,
  setIsComposing,
  setIsInputFocused,
  activeSession,
  handleKeyDown,
  handleStop,
  handleSend,
  activeIntent,
  intentLabel,
  IntentIcon,
  showIntentMenu,
  setShowIntentMenu,
  handleQuickAction,
  intentMenuRef,
  t,
  activeModelOptions,
  handleSessionModelChange,
  activeModelPlaceholder,
  isAgentSession,
  showAuthGate,
  quickActions,
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="w-full overflow-hidden min-h-[24px]">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={inputPlaceholder}
          disabled={!activeSession || !isInputReady}
          autoFocus={Boolean(activeSession && isInputReady)}
          rows={1}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          className="w-full resize-none bg-transparent text-[13px] leading-[20px] text-zinc-800 dark:text-zinc-100 outline-none focus:outline-none focus:ring-0 ring-0 border-none disabled:opacity-60 placeholder-zinc-400 dark:placeholder-zinc-500 overflow-y-auto px-2"
          style={{
            height: 'auto',
            minHeight: '24px',
            maxHeight: '200px',
          }}
        />
      </div>

      <div className="flex items-center justify-between min-h-[28px] gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <IntentSelector
            activeIntent={activeIntent}
            intentLabel={intentLabel}
            IntentIcon={IntentIcon}
            showIntentMenu={showIntentMenu}
            setShowIntentMenu={setShowIntentMenu}
            handleQuickAction={handleQuickAction}
            t={t}
            intentMenuRef={intentMenuRef}
            quickActions={quickActions}
          />

          {activeSession && isAgentSession && (
            <ModelSelector
              value={activeSession.model || ''}
              options={activeModelOptions}
              onChange={handleSessionModelChange}
              disabled={isGenerating || showAuthGate}
              placeholder={activeModelPlaceholder}
              className="max-w-[140px]"
            />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            className={`h-7 w-7 rounded-lg flex-shrink-0 flex items-center justify-center transition-all duration-200 ${
              isGenerating
                ? 'bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-200'
                : (!inputValue.trim() || !activeSession || !isInputReady)
                   ? 'bg-zinc-100 text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed'
                   : 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-sm'
            }`}
            onClick={isGenerating ? handleStop : handleSend}
            disabled={isGenerating ? false : (!inputValue.trim() || !activeSession || !isInputReady)}
            title={isGenerating ? t('agent.stop') : t('agent.send')}
          >
            {isGenerating ? <div className="h-2 w-2 rounded-sm bg-current" /> : <ArrowUpIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
