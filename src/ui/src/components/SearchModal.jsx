import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MagnifyingGlassIcon,
  DocumentTextIcon,
  FolderIcon,
  XMarkIcon,
  SparklesIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { semanticSearch } from '../api';
import { formatRelativeTime, formatDateKey } from '../utils/ideaUtils';

// Debounce hook
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Highlight matched text
function HighlightText({ text, query, maxLength = 200 }) {
  if (!text || !query) {
    const truncated = text?.length > maxLength ? text.slice(0, maxLength) + '...' : text;
    return <span className="text-gray-500">{truncated}</span>;
  }

  const truncated = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  const parts = truncated.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));

  return (
    <span className="text-gray-500 dark:text-zinc-500">
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <span key={i} className="text-gray-900 dark:text-zinc-100 font-medium border-b border-gray-300/60 dark:border-zinc-700/60 bg-yellow-100/50 dark:bg-yellow-500/20 px-0.5 rounded-[1px]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

function normalizeIdeaTitleFromContent(content, maxLength = 48) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) || raw;
  const normalized = firstLine.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function isIdeaHit(hit) {
  const docType = hit?.doc_type || hit?.docType;
  if (docType) return docType === 'idea';
  const filePath = String(hit?.file_path || hit?.filePath || '');
  return filePath.startsWith('.ideas/');
}

function getIdeaDisplayName(result, untitledLabel) {
  const candidate = String(result?.display_name || result?.title || '').trim();
  if (candidate && candidate !== untitledLabel) return candidate;
  const fromContent = normalizeIdeaTitleFromContent(result?.content);
  return fromContent || untitledLabel;
}

// Search result item
function SearchResultItem({ result, query, isSelected, onClick }) {
  const { t } = useTranslation();
  const isIdea = result.kind === 'idea';
  const isFolder = result.folder_path !== undefined && result.aggregate_type === 'folder';
  const displayPath = result.file_path || result.folder_path || '';
  const untitledLabel = t('search.untitled');
  const displayName = isIdea
    ? getIdeaDisplayName(result, untitledLabel)
    : (result.display_name || result.title || displayPath.split('/').pop()?.replace('.md', '') || untitledLabel);
  const ideaBox = isIdea ? result.ideaBox || result.idea_box : '';
  const ideaBoxLabel = ideaBox === 'inbox' ? t('idea.boxInbox', 'Inbox') : ideaBox;
  const ideaMeta = isIdea
    ? [t('search.ideas', 'Ideas'), ideaBoxLabel, result.relativeTime].filter(Boolean).join(' · ')
    : '';

  // Format heading path for display - Notion style breadcrumbs
  const headingDisplay = result.heading_path ? (
    <span className="flex items-center gap-1 text-gray-400">
      <span className="opacity-40">/</span>
      <span>{result.heading_path}</span>
    </span>
  ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full text-left px-4 py-3 flex items-start gap-3 transition-colors duration-75 group
        ${isSelected 
          ? 'bg-[rgba(55,53,47,0.08)] dark:bg-[rgba(161,161,170,0.16)]'
          : 'hover:bg-[rgba(55,53,47,0.03)] dark:hover:bg-[rgba(161,161,170,0.08)]'
        }
      `}
    >
      <div className={`
        mt-0.5 p-1 flex-shrink-0 text-gray-400 dark:text-zinc-500
        ${isSelected ? 'text-gray-600 dark:text-zinc-300' : ''}
      `}>
        {isIdea ? (
          <SparklesIcon className="h-5 w-5" strokeWidth={1.5} />
        ) : isFolder ? (
          <FolderIcon className="h-5 w-5" strokeWidth={1.5} />
        ) : (
          <DocumentTextIcon className="h-5 w-5" strokeWidth={1.5} />
        )}
      </div>
      
      <div className="flex-1 min-w-0 overflow-hidden py-0.5">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[14px] truncate font-medium ${isSelected ? 'text-gray-900 dark:text-zinc-100' : 'text-[#37352f] dark:text-zinc-300'}`}>
            {displayName}
          </span>
          {/* Hidden score for debug, or could be shown very subtly */}
          {/* <span className="text-[10px] text-gray-300 ml-auto font-mono">{(result.score * 100).toFixed(0)}%</span> */}
        </div>
        
        {/* Breadcrumbs / Path */}
        <div className="flex items-center gap-1 text-[12px] text-gray-400 dark:text-zinc-500 truncate font-normal mb-1.5 leading-none">
          <span className="truncate">{isIdea ? ideaMeta : displayPath}</span>
          {!isIdea && headingDisplay}
        </div>
        
        {result.content && (
          <div className="text-[12px] leading-relaxed line-clamp-2 mt-1 font-normal">
            <HighlightText text={result.content} query={query} maxLength={120} />
          </div>
        )}

        {/* Technical metadata - only show for content-level results, not aggregated docs */}
        {result.matched_by && !result.aggregate_type && (
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-gray-400 dark:text-zinc-600">
             {result.matched_by === 'vector' && (
               <>
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                 <span>语义匹配</span>
               </>
             )}
             {result.matched_by === 'keyword' && (
               <>
                 <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                 <span>关键词匹配</span>
               </>
             )}
             {result.matched_by === 'vector+keyword' && (
               <>
                 <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                 <span>语义+关键词</span>
               </>
             )}
          </div>
        )}
      </div>

      {/* Enter key hint that appears on selection - Notion style */}
      {isSelected && (
        <div className="flex-shrink-0 self-center hidden sm:block">
          <span className="text-[10px] font-medium text-gray-400 dark:text-zinc-500 px-1.5 py-0.5 border border-gray-200 dark:border-zinc-700 rounded">↵</span>
        </div>
      )}
    </button>
  );
}

export function SearchModal({ isOpen, onClose, onSelectDoc, onSelectIdea }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [ideaResults, setIdeaResults] = useState([]);
  const [category, setCategory] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState(null);
  const [indexMissing, setIndexMissing] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const itemRefs = useRef([]);
  const filterRef = useRef(null);
  
  const debouncedQuery = useDebounce(query, 300);
  const combinedResults = useMemo(() => {
    if (category === 'idea') return ideaResults;
    if (category === 'doc') return results;
    return [...ideaResults, ...results];
  }, [category, ideaResults, results]);
  const placeholderText = useMemo(() => {
    if (category === 'doc') return t('search.placeholderDocs');
    if (category === 'idea') return t('search.placeholderIdeas');
    return t('search.placeholder');
  }, [category, t]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setIdeaResults([]);
      setCategory('all');
      setSelectedIndex(0);
      setError(null);
      setIsFilterOpen(false);
    }
  }, [isOpen]);

  // Search when query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setIdeaResults([]);
      setError(null);
      setIndexMissing(false);
      setSelectedIndex(0);
      return;
    }

    const doSearch = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let docResponse = { results: [], indexMissing: false };
        let ideaResponse = { results: [], indexMissing: false };

        if (category !== 'idea') {
          docResponse = await semanticSearch(debouncedQuery, {
            limit: 12,
            mode: 'hybrid',
            aggregateBy: 'doc',
            docType: 'doc',
          });
        }

        if (category !== 'doc') {
          ideaResponse = await semanticSearch(debouncedQuery, {
            limit: 12,
            mode: 'hybrid',
            aggregateBy: 'content',
            docType: 'idea',
          });
        }

        const normalizedIdeas = (ideaResponse.results || [])
          .filter(isIdeaHit)
          .map((hit) => {
            const createdAt = hit.entry_created_at || '';
            const date = hit.entry_date || (createdAt ? formatDateKey(createdAt) : '');
            return {
              kind: 'idea',
              threadId: hit.file_path,
              entryId: hit.entry_id || '',
              date,
              title: hit.display_name || hit.title || '',
              content: hit.content || '',
              updatedAt: createdAt,
              relativeTime: createdAt ? formatRelativeTime(createdAt) : '',
              ideaBox: hit.idea_box || hit.ideaBox || '',
            };
          });

        setResults(docResponse.results || []);
        setIdeaResults(normalizedIdeas);
        setIndexMissing(docResponse.indexMissing || ideaResponse.indexMissing || false);
        if ((docResponse.error && !docResponse.indexMissing) || (ideaResponse.error && !ideaResponse.indexMissing)) {
          setError(docResponse.error || ideaResponse.error);
        }
        setSelectedIndex(0);
      } catch (err) {
        setError(err.message);
        setResults([]);
        setIdeaResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    doSearch();
  }, [debouncedQuery, category, t]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [category]);

  useEffect(() => {
    if (!isFilterOpen) return;
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFilterOpen]);

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex, combinedResults.length]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (combinedResults.length === 0) {
      if (e.key === 'Escape') onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, combinedResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && combinedResults.length > 0) {
      e.preventDefault();
      const selected = combinedResults[selectedIndex];
      if (selected?.kind === 'idea') {
        onSelectIdea?.(selected);
        onClose();
      } else if (selected?.file_path) {
        onSelectDoc({ rel_path: selected.file_path });
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [combinedResults, selectedIndex, onSelectDoc, onSelectIdea, onClose]);

  // Handle clicking outside
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle selecting a result
  const handleSelectResult = useCallback((result) => {
    if (result?.kind === 'idea') {
      onSelectIdea?.(result);
      onClose();
      return;
    }
    if (result?.file_path) {
      onSelectDoc({ rel_path: result.file_path });
      onClose();
    }
  }, [onSelectDoc, onSelectIdea, onClose]);

  // Platform detection for keyboard shortcut display
  const isMac = useMemo(() => {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  }, []);

  if (!isOpen) return null;
  let itemIndex = 0;

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
        onClick={handleBackdropClick}
      />
      
      {/* Modal - Notion style rounded corners, shadow, and background */}
      <div 
        className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200 flex flex-col max-h-[70vh]"
        style={{ boxShadow: '0 20px 50px -12px rgba(0, 0, 0, 0.25)' }}
      >
        {/* Search Input Area */}
        <div className="px-4 py-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <div ref={filterRef} className="relative">
              <button
                type="button"
                onClick={() => setIsFilterOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-2 py-1 text-[12px] font-medium text-gray-500 dark:text-zinc-400 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-800 dark:hover:text-zinc-200 transition-colors"
                aria-haspopup="listbox"
                aria-expanded={isFilterOpen}
              >
                <span className="text-gray-700 dark:text-zinc-300">
                  {category === 'all' ? t('search.all') : category === 'doc' ? t('search.docs') : t('search.ideas')}
                </span>
                <ChevronDownIcon className="h-3 w-3 text-gray-400 dark:text-zinc-500" />
              </button>
              {isFilterOpen && (
                <div className="absolute left-0 mt-1 min-w-[140px] rounded-lg bg-white dark:bg-zinc-800 shadow-lg ring-1 ring-black/5 dark:ring-white/5 py-1 z-10">
                  {['all', 'doc', 'idea'].map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setCategory(item);
                        setIsFilterOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${
                        category === item ? 'bg-gray-100 dark:bg-zinc-700 text-gray-800 dark:text-zinc-100' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-700/50'
                      }`}
                    >
                      {item === 'all' ? t('search.all') : item === 'doc' ? t('search.docs') : t('search.ideas')}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="h-4 w-px bg-gray-200 dark:bg-zinc-700" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              className="flex-1 text-lg text-[#37352f] dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 bg-transparent border-none focus:ring-0 p-0 outline-none leading-tight"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
              >
                <XMarkIcon className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="flex items-center p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
              aria-label={t('search.open')}
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        <div 
          ref={resultsRef}
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent bg-white dark:bg-zinc-900"
        >
          {/* Loading state */}
          {isLoading && query && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-5 w-5 border-2 border-gray-200 dark:border-zinc-700 border-t-gray-500 dark:border-t-zinc-400 rounded-full animate-spin" />
            </div>
          )}

          {/* Index missing warning */}
          {indexMissing && !isLoading && (
            <div className="px-5 py-8 text-center">
              <p className="text-gray-600 dark:text-zinc-400 text-sm mb-2">{t('search.indexMissing')}</p>
              <code className="text-xs bg-gray-100 dark:bg-zinc-800 px-2 py-1 rounded text-gray-600 dark:text-zinc-400 font-mono">
                oc index build
              </code>
            </div>
          )}

          {/* Error state */}
          {error && !indexMissing && !isLoading && (
            <div className="px-5 py-8 text-center text-red-500 text-sm">
              <p>{error}</p>
            </div>
          )}

          {/* Results list */}
          {!isLoading && !error && !indexMissing && combinedResults.length > 0 && (
            <div className="py-2">
              {category !== 'doc' && ideaResults.length > 0 && (
                <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-500/80 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  {t('search.ideas', 'Ideas')}
                </div>
              )}
              {category !== 'doc' && ideaResults.map((result, index) => {
                const currentIndex = itemIndex++;
                return (
                  <div
                    key={`idea-${result.threadId}-${index}`}
                    ref={(el) => { itemRefs.current[currentIndex] = el; }}
                  >
                    <SearchResultItem
                      result={result}
                      query={query}
                      isSelected={currentIndex === selectedIndex}
                      onClick={() => handleSelectResult(result)}
                    />
                  </div>
                );
              })}
              {category !== 'idea' && results.length > 0 && (
                <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-500/80 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  {t('search.docs', 'Docs')}
                </div>
              )}
              {category !== 'idea' && results.map((result, index) => {
                const currentIndex = itemIndex++;
                return (
                  <div
                    key={`${result.file_path}-${index}`}
                    ref={(el) => { itemRefs.current[currentIndex] = el; }}
                  >
                    <SearchResultItem
                      result={result}
                      query={query}
                      isSelected={currentIndex === selectedIndex}
                      onClick={() => handleSelectResult(result)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && !indexMissing && query && ideaResults.length === 0 && results.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-gray-500 dark:text-zinc-500 text-sm">{t('search.noResults')}</p>
            </div>
          )}

          {/* Initial state - tips */}
          {!query && !isLoading && (
            <div className="px-8 py-12">
              <div className="text-center">
                <p className="text-gray-400 dark:text-zinc-600 text-sm">{t('search.tip')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-zinc-950 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-gray-400 dark:text-zinc-500 select-none">
          <span className="flex items-center gap-2">
            <span className="flex gap-0.5">
              <kbd className="font-sans px-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded text-gray-500 dark:text-zinc-400">↑</kbd>
              <kbd className="font-sans px-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded text-gray-500 dark:text-zinc-400">↓</kbd>
            </span>
            <span>{t('search.navigate')}</span>
            <kbd className="font-sans px-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded text-gray-500 dark:text-zinc-400 ml-2">↵</kbd>
            <span>{t('search.open')}</span>
          </span>
          <span className="flex items-center gap-1 opacity-60">
            <span>{t('app.name')} Search</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// Hook for global keyboard shortcut
export function useSearchShortcut(callback) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ⌘K on Mac, Ctrl+K on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        callback();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [callback]);
}
