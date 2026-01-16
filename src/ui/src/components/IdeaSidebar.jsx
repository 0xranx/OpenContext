/**
 * IdeaSidebar - Idea 模块侧边栏分区
 * 
 * 显示按天分组的导航列表
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  PlusIcon,
  CalendarIcon,
  SparklesIcon,
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { formatDateDisplay, formatDateKey } from '../utils/ideaUtils';

export default function IdeaSidebar({
  isExpanded,
  onToggleExpand,
  boxes = [],
  selectedBox,
  availableDatesByBox = {},
  onSelectBox,
  onCreateBox,
  onRenameBox,
  onDeleteBox,
  selectedDate,
  onSelectDate,
}) {
  const { t } = useTranslation();
  const [expandedBoxes, setExpandedBoxes] = useState(() => new Set(selectedBox ? [selectedBox] : []));
  const lastSelectedBoxRef = useRef(selectedBox);
  const [menuBox, setMenuBox] = useState(null);
  const menuRef = useRef(null);
  const todayKey = useMemo(() => formatDateKey(new Date()), []);

  useEffect(() => {
    if (!selectedBox) return;
    if (selectedBox !== lastSelectedBoxRef.current) {
      setExpandedBoxes((prev) => {
        if (prev.has(selectedBox)) return prev;
        const next = new Set(prev);
        next.add(selectedBox);
        return next;
      });
      lastSelectedBoxRef.current = selectedBox;
    }
  }, [selectedBox]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuBox(null);
      }
    };
    if (menuBox) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuBox]);

  const buildDisplayDates = useCallback(
    (dates = []) => {
      const set = new Set(dates);
      set.add(todayKey);
      return Array.from(set).sort((a, b) => b.localeCompare(a));
    },
    [todayKey]
  );

  return (
    <div className="mb-2">
      {/* Section Header */}
      <div
        className="flex items-center gap-1 px-3 py-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:bg-[#EFEFED] dark:text-zinc-500 dark:hover:bg-zinc-800 cursor-pointer group"
        onClick={onToggleExpand}
      >
        {isExpanded ? (
          <ChevronDownIcon className="w-3 h-3" />
        ) : (
          <ChevronRightIcon className="w-3 h-3" />
        )}
        <span>{t('idea.sidebarTitle', '想法 (Ideas)')}</span>
        <button
          className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 hover:text-gray-900 dark:hover:text-zinc-100"
          onClick={(e) => {
            e.stopPropagation();
            onCreateBox?.();
          }}
          title={t('idea.addBox', 'New box')}
        >
          <PlusIcon className="w-3 h-3" />
        </button>
      </div>

      {/* Ideas Box List */}
      {isExpanded && (
        <div className="mt-1">
          {(boxes.length ? boxes : ['inbox']).map((box) => {
            const isBoxExpanded = expandedBoxes.has(box);
            const isSelected = selectedBox === box;
            const label = box === 'inbox' ? t('idea.boxInbox', 'Inbox') : box;
            return (
              <div key={box} className="mb-1">
                <div
                  className="group flex items-center gap-2 mx-2 px-3 py-1.5 text-sm cursor-pointer transition-colors rounded-sm text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  onClick={() => {
                    setExpandedBoxes((prev) => {
                      const next = new Set(prev);
                      if (next.has(box)) {
                        next.delete(box);
                      } else {
                        next.add(box);
                      }
                      return next;
                    });
                  }}
                >
                  <button
                    type="button"
                    className="p-0.5 rounded-sm hover:bg-gray-200/70 dark:hover:bg-zinc-700/50"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedBoxes((prev) => {
                        const next = new Set(prev);
                        if (next.has(box)) {
                          next.delete(box);
                        } else {
                          next.add(box);
                        }
                        return next;
                      });
                    }}
                  >
                    {isBoxExpanded ? (
                      <ChevronDownIcon className="w-3 h-3 text-gray-400 dark:text-zinc-500" />
                    ) : (
                      <ChevronRightIcon className="w-3 h-3 text-gray-400 dark:text-zinc-500" />
                    )}
                  </button>
                  <SparklesIcon className="w-4 h-4 text-gray-400 dark:text-zinc-500" />
                  <span className="truncate">{label}</span>
                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuBox((prev) => (prev === box ? null : box));
                      }}
                      className="p-1 rounded hover:bg-gray-200/70 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
                      title={t('common.edit', 'Edit')}
                    >
                      <EllipsisHorizontalIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {menuBox === box && (
                  <div ref={menuRef} className="relative mx-2">
                    <div className="absolute right-2 top-0 mt-1 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50 min-w-[140px] dark:bg-zinc-800 dark:border-zinc-700">
                      <button
                        type="button"
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-zinc-700 text-left ${box === 'inbox' ? 'text-gray-300 dark:text-zinc-600 cursor-not-allowed' : 'text-gray-700 dark:text-zinc-200'}`}
                        onClick={() => {
                          if (box === 'inbox') return;
                          setMenuBox(null);
                          onRenameBox?.(box);
                        }}
                        disabled={box === 'inbox'}
                      >
                        <PencilIcon className={`h-4 w-4 ${box === 'inbox' ? 'text-gray-300 dark:text-zinc-600' : 'text-gray-500 dark:text-zinc-400'}`} />
                        {t('contextMenu.rename', '重命名')}
                      </button>
                      <button
                        type="button"
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-zinc-700 text-left ${box === 'inbox' ? 'text-gray-300 dark:text-zinc-600 cursor-not-allowed' : 'text-red-600 dark:text-red-400'}`}
                        onClick={() => {
                          if (box === 'inbox') return;
                          setMenuBox(null);
                          onDeleteBox?.(box);
                        }}
                        disabled={box === 'inbox'}
                      >
                        <TrashIcon className={`h-4 w-4 ${box === 'inbox' ? 'text-gray-300 dark:text-zinc-600' : 'text-red-500 dark:text-red-400'}`} />
                        {t('contextMenu.delete', '删除')}
                      </button>
                    </div>
                  </div>
                )}

                {isBoxExpanded && (
                  <div className="mt-1 ml-10 pl-4 border-l border-gray-200 dark:border-zinc-700">
                    {buildDisplayDates(availableDatesByBox[box] || []).map((dateKey) => (
                      <div
                        key={`${box}-${dateKey}`}
                        onClick={() => onSelectDate(dateKey, box)}
                        className={`flex items-center gap-2 mr-2 px-3 py-1.5 text-sm cursor-pointer transition-colors rounded-sm ${
                          selectedDate === dateKey && selectedBox === box
                            ? 'bg-gray-200 text-gray-900 font-medium dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <CalendarIcon className="w-4 h-4 text-gray-400 dark:text-zinc-500" />
                        <span>{formatDateDisplay(dateKey)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
