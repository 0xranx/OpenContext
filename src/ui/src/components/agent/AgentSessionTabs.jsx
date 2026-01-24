import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

export const AgentSessionTabs = ({
  sessions,
  activeId,
  setActiveId,
  createViewOpen,
  setCreateViewOpen,
  onRenameSession,
  onDeleteSession,
  t,
}) => {
  return (
    <div className="flex items-center justify-between px-2 border-b border-zinc-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/50 h-12 flex-shrink-0">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 mr-2 h-full">
        {sessions.length === 0 && (
          <div className="text-xs font-medium text-zinc-400 dark:text-zinc-500 px-2 select-none">
            {createViewOpen ? t('agent.startTitle') : t('agent.title')}
          </div>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`flex-shrink-0 flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer ${
              activeId === session.id
                ? 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 shadow-sm'
                : 'bg-transparent border-transparent text-zinc-500 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
            }`}
            onClick={() => setActiveId(session.id)}
            onDoubleClick={() => onRenameSession(session)}
          >
            <span className="truncate max-w-[120px] font-medium">{session.name}</span>
            <button
              type="button"
              className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 ml-1"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSession(session);
              }}
              title={t('common.delete')}
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 pl-2 border-l border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
          onClick={() => setCreateViewOpen((prev) => !prev)}
          title={createViewOpen ? t('common.cancel') : t('agent.newSession')}
        >
          <PlusIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${createViewOpen ? 'rotate-45' : ''}`} />
        </button>
      </div>
    </div>
  );
};
