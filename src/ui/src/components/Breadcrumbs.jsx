import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

export function Breadcrumbs({ selectedDoc, saveState }) {
  const { t } = useTranslation();
  
  if (!selectedDoc?.rel_path) {
    return <span className="text-sm text-gray-400 dark:text-zinc-500">{t('emptyState.title')}</span>;
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-500 overflow-hidden">
      {selectedDoc.rel_path.split('/').map((part, i, arr) => {
        const isLast = i === arr.length - 1;
        return (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="flex items-center gap-2 whitespace-nowrap">
            {i > 0 && <span className="text-gray-300 dark:text-zinc-700">/</span>}
            <span className={`${isLast ? 'font-medium text-gray-900 dark:text-zinc-200' : 'hover:text-gray-700 dark:hover:text-zinc-300 cursor-pointer'}`}>
              {part.replace('.md', '')}
            </span>
          </div>
        );
      })}
      {saveState === 'saving' && <ArrowPathIcon className="h-3 w-3 animate-spin text-gray-400 dark:text-zinc-500 ml-2" />}
      {saveState === 'success' && <CheckCircleIcon className="h-3 w-3 text-green-500 ml-2" />}
      {saveState === 'error' && <ExclamationTriangleIcon className="h-3 w-3 text-red-500 ml-2" />}
    </div>
  );
}


