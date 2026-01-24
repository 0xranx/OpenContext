export const AgentEmptyState = ({
  activeSession,
  showAuthGateInEmpty,
  renderAuthGateCard,
  setCreateViewOpen,
  t,
}) => {
  if (!activeSession) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 text-xs gap-2">
        <div className="text-sm font-semibold text-zinc-500">{t('agent.startTitle')}</div>
        <div className="max-w-[220px] text-zinc-400">{t('agent.startDescription')}</div>
        <button
          type="button"
          className="mt-2 px-3 py-1.5 text-xs rounded bg-black text-white hover:bg-zinc-800"
          onClick={() => setCreateViewOpen(true)}
        >
          {t('agent.newSession')}
        </button>
      </div>
    );
  }

  if (activeSession.messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 text-xs gap-2">
        {showAuthGateInEmpty ? (
          <div className="w-full max-w-[320px]">{renderAuthGateCard('large')}</div>
        ) : (
          <>
            <div className="text-sm font-semibold text-zinc-500">{t('agent.emptyTitle')}</div>
            <div className="max-w-[220px] text-zinc-400">{t('agent.emptyDescription')}</div>
          </>
        )}
      </div>
    );
  }

  return null;
};
