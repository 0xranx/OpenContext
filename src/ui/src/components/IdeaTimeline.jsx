/**
 * IdeaTimeline - Idea 模块主内容区域
 * 
 * 显示所有 entries，按日期分组，支持快速添加新想法
 * 左侧日期导航用于快速滚动定位
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SparklesIcon,
  PhotoIcon,
  ArrowPathIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { formatRelativeTime, formatDateDisplay } from '../utils/ideaUtils';
import { useAI } from '../context/AIContext';
import styles from './IdeaTimeline.module.css';
import PageRefPicker from '../editor/tiptap/PageRefPicker';
import * as api from '../api';
import { buildIdeaRefUrl, parseIdeaRefUrl } from '../utils/ideaRef';

export default function IdeaTimeline({
  selectedDate,
  selectedBox,
  allEntriesGrouped,
  isLoading,
  onAddEntry,
  onContinueThread,
  onAddAIReflection,
  onDeleteEntry,
  onRequestMoveThread,
  onOpenDocById,
  onOpenIdeaRef,
  focusEntryId,
  onClearFocusEntry,
  onRefresh,
}) {
  const { t } = useTranslation();
  const boxLabel = selectedBox === 'inbox' ? t('idea.boxInbox', 'Inbox') : (selectedBox || '');
  const { isAvailable: isAIAvailable, generateReflection, isGenerating } = useAI();
  const [inputText, setInputText] = useState('');
  const [inputImages, setInputImages] = useState([]);
  const [inputRefs, setInputRefs] = useState([]);
  const [isPosting, setIsPosting] = useState(false);
  const [docMetaByHref, setDocMetaByHref] = useState({});
  const [refTarget, setRefTarget] = useState('main');
  const textareaRef = useRef(null);
  const inputImageInputRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const dateRefsMap = useRef(new Map());
  const entryRefsMap = useRef(new Map());
  const [isPageRefOpen, setIsPageRefOpen] = useState(false);

  // 继续写的状态
  const [replyingThreadId, setReplyingThreadId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyImages, setReplyImages] = useState([]);
  const [replyRefs, setReplyRefs] = useState([]);
  const [isReplying, setIsReplying] = useState(false);
  const replyInputRef = useRef(null);
  const replyImageInputRef = useRef(null);

  // AI 反思的状态
  const [reflectingThreadId, setReflectingThreadId] = useState(null);
  const [reflectionText, setReflectionText] = useState('');
  const [reflectionError, setReflectionError] = useState('');
  const [isReflecting, setIsReflecting] = useState(false);
  const reflectionInputRef = useRef(null);
  const [animatedEntryId, setAnimatedEntryId] = useState(null);
  const animationTimeoutRef = useRef(null);
  const prevEntryIdsRef = useRef(new Set());
  const [pendingDelete, setPendingDelete] = useState(null);

  // 总 entries 数量
  const totalEntries = useMemo(() => {
    return allEntriesGrouped.reduce((sum, group) => sum + group.entries.length, 0);
  }, [allEntriesGrouped]);

  useEffect(() => {
    if (isReflecting) return;
    const el = reflectionInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [reflectionText, isReflecting]);

  // 滚动到选中的日期
  useEffect(() => {
    if (selectedDate && dateRefsMap.current.has(selectedDate)) {
      const el = dateRefsMap.current.get(selectedDate);
      if (el && scrollContainerRef.current) {
        // 平滑滚动到目标位置
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!focusEntryId) return;
    const el = entryRefsMap.current.get(focusEntryId);
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onClearFocusEntry?.();
    }
  }, [focusEntryId, onClearFocusEntry]);

  useEffect(() => {
    const nextIds = [];
    const entryById = new Map();
    for (const group of allEntriesGrouped) {
      for (const entry of group.entries) {
        nextIds.push(entry.id);
        entryById.set(entry.id, entry);
      }
    }

    const prevIds = prevEntryIdsRef.current;
    const addedIds = nextIds.filter((id) => !prevIds.has(id));
    if (addedIds.length > 0) {
      let newestId = addedIds[0];
      for (const id of addedIds) {
        const candidate = entryById.get(id);
        const current = entryById.get(newestId);
        if (candidate && current) {
          const candidateTime = new Date(candidate.createdAt).getTime();
          const currentTime = new Date(current.createdAt).getTime();
          if (candidateTime > currentTime) {
            newestId = id;
          }
        }
      }

      setAnimatedEntryId(newestId);
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
      animationTimeoutRef.current = setTimeout(() => {
        setAnimatedEntryId(null);
      }, 220);
    }

    prevEntryIdsRef.current = new Set(nextIds);
  }, [allEntriesGrouped]);

  // 当开始回复时，自动聚焦输入框
  useEffect(() => {
    if (replyingThreadId && replyInputRef.current) {
      replyInputRef.current.focus();
    }
  }, [replyingThreadId]);

  const handlePost = useCallback(async () => {
    if ((!inputText.trim() && inputImages.length === 0 && inputRefs.length === 0) || isPosting) return;
    
    setIsPosting(true);
    try {
      const refLines = inputRefs.map((ref) => `[${ref.label}](${ref.href})`);
      const content = [inputText.trim(), ...refLines].filter(Boolean).join('\n');
      await onAddEntry?.(content, { images: inputImages });
      setInputText('');
      setInputImages([]);
      setInputRefs([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      console.error('Failed to add entry:', err);
    } finally {
      setIsPosting(false);
    }
  }, [inputText, inputImages, inputRefs, isPosting, onAddEntry]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handlePost();
      }
    },
    [handlePost]
  );

  const handleTextareaInput = useCallback((e) => {
    setInputText(e.target.value);
    // 自动调整高度
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  }, []);

  const insertIntoInput = useCallback((text) => {
    const el = textareaRef.current;
    if (!el) {
      setInputText((prev) => `${prev}${text}`);
      return;
    }
    const start = el.selectionStart ?? inputText.length;
    const end = el.selectionEnd ?? inputText.length;
    const next = `${inputText.slice(0, start)}${text}${inputText.slice(end)}`;
    setInputText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
  }, [inputText]);

  const insertCardIntoInput = useCallback((text) => {
    const el = textareaRef.current;
    if (!el) {
      setInputText((prev) => `${prev}\n${text}\n`);
      return;
    }
    const start = el.selectionStart ?? inputText.length;
    const end = el.selectionEnd ?? inputText.length;
    const before = inputText.slice(0, start);
    const after = inputText.slice(end);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n' : '';
    const next = `${before}${prefix}${text}${suffix}${after}`;
    setInputText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + prefix + text + suffix).length;
      el.setSelectionRange(pos, pos);
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
  }, [inputText]);

  const insertDocRef = useCallback(async (doc) => {
    const label = (doc.rel_path || '').split('/').pop()?.replace(/\.md$/i, '') || t('editor.page', 'Page');
    const relPath = String(doc?.rel_path || '').trim();
    const fallbackPath = encodeURIComponent(relPath);
    let stableId = String(doc?.stable_id || doc?.stableId || '').trim();
    let description = String(doc?.description || doc?.desc || '').trim();
    if (!stableId && relPath) {
      try {
        const meta = await api.getDocMeta(relPath);
        stableId = String(meta?.stable_id || meta?.stableId || '').trim();
        description = description || String(meta?.description || '').trim();
      } catch {
        // ignore
      }
    }
    const url = stableId
      ? (fallbackPath ? `oc://doc/${stableId}?path=${fallbackPath}` : `oc://doc/${stableId}`)
      : (fallbackPath ? `oc://doc/?path=${fallbackPath}` : '');
    if (!url) return;
    if (refTarget === 'reply') {
      setReplyRefs((prev) => [...prev, { type: 'doc', label, href: url, description }]);
    } else {
      setInputRefs((prev) => [...prev, { type: 'doc', label, href: url, description }]);
    }
    setIsPageRefOpen(false);
  }, [t, refTarget]);

  const insertIdeaRef = useCallback((thread) => {
    if (!thread) return;
    const firstEntry = thread.entries?.[0];
    const titleLine = String(firstEntry?.content || '').split('\n')[0].trim();
    const label = thread.title || titleLine || t('idea.untitled', 'Untitled idea');
    const date = firstEntry?.createdAt ? new Date(firstEntry.createdAt).toISOString().slice(0, 10) : '';
    const url = buildIdeaRefUrl({
      threadId: thread.id,
      date,
    });
    if (refTarget === 'reply') {
      setReplyRefs((prev) => [...prev, { type: 'idea', label, href: url }]);
    } else {
      setInputRefs((prev) => [...prev, { type: 'idea', label, href: url }]);
    }
    setIsPageRefOpen(false);
  }, [t, refTarget]);

  const parseDocHref = useCallback((href) => {
    let stableId = '';
    let fallbackRelPath = '';
    try {
      const u = new URL(href);
      stableId = String(u.pathname || '').replace(/^\/+/, '').trim();
      fallbackRelPath = decodeURIComponent(u.searchParams.get('path') || '').trim();
    } catch {
      stableId = href.slice('oc://doc/'.length).trim();
    }
    return { stableId, fallbackRelPath };
  }, []);

  const handleRefClick = useCallback((href) => {
    if (href.startsWith('oc://doc/')) {
      const { stableId, fallbackRelPath } = parseDocHref(href);
      onOpenDocById?.(stableId, { fallbackRelPath });
      return;
    }
    if (href.startsWith('oc://idea/')) {
      const parsed = parseIdeaRefUrl(href);
      if (parsed) onOpenIdeaRef?.(parsed);
    }
  }, [onOpenDocById, onOpenIdeaRef, parseDocHref]);

  useEffect(() => {
    const hrefs = new Set();
    allEntriesGrouped.forEach((group) => {
      group.entries.forEach((entry) => {
        const text = String(entry.text || '');
        const regex = /\[[^\]]+\]\((oc:\/\/doc\/[^)]+)\)/g;
        let match = regex.exec(text);
        while (match) {
          hrefs.add(match[1]);
          match = regex.exec(text);
        }
      });
    });

    const missing = Array.from(hrefs).filter((href) => !docMetaByHref[href]);
    if (!missing.length) return;
    let cancelled = false;
    missing.forEach(async (href) => {
      const { stableId, fallbackRelPath } = parseDocHref(href);
      try {
        const meta = stableId
          ? await api.getDocById(stableId)
          : (fallbackRelPath ? await api.getDocMeta(fallbackRelPath) : null);
        if (!meta || cancelled) return;
        setDocMetaByHref((prev) => ({ ...prev, [href]: meta }));
      } catch {
        // ignore
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allEntriesGrouped, docMetaByHref, parseDocHref]);

  const renderEntryText = useCallback((entry) => {
    const text = String(entry.text || '');
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^\[([^\]]+)\]\((oc:\/\/[^)]+)\)\s*$/);
      if (match) {
        const label = match[1];
        const href = match[2];
        if (href.startsWith('oc://doc/') || href.startsWith('oc://idea/')) {
          const isIdea = href.startsWith('oc://idea/');
          const docMeta = !isIdea ? docMetaByHref[href] : null;
          const description = docMeta?.description || docMeta?.desc || '';
          const subtitle = description || docMeta?.rel_path || '';
          return (
            <div key={`ref-${entry.id}-${idx}`} className="my-2">
              <button
                type="button"
                onClick={() => handleRefClick(href)}
                className={styles.refCard}
              >
                <span className={`${styles.refCardIcon} ${isIdea ? styles.refCardIconIdea : styles.refCardIconDoc}`} />
                <div className={styles.refCardContent}>
                  <div className={styles.refCardLabel}>
                    {isIdea ? t('pageRef.tabIdeas', 'Ideas') : t('pageRef.tabPages', 'Docs')}
                  </div>
                  <div className={styles.refCardTitle}>
                    {label}
                  </div>
                  {subtitle && (
                    <div className={styles.refCardDesc}>
                      {subtitle}
                    </div>
                  )}
                </div>
              </button>
            </div>
          );
        }
      }
      return (
        <span key={`line-${entry.id}-${idx}`}>
          {line}
          {idx < lines.length - 1 && <br />}
        </span>
      );
    });
  }, [handleRefClick, t]);

  // 开始继续写
  const handleStartContinue = useCallback((threadId) => {
    setReplyingThreadId(threadId);
    setReplyText('');
    setReplyImages([]);
    setReplyRefs([]);
  }, []);

  // 取消继续写
  const handleCancelContinue = useCallback(() => {
    setReplyingThreadId(null);
    setReplyText('');
    setReplyImages([]);
    setReplyRefs([]);
  }, []);

  const readImageAsDataUrl = useCallback((file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const addReplyImageFiles = useCallback(async (files) => {
    const nextImages = [];
    for (const file of files) {
      if (!file || !file.type?.startsWith('image/')) continue;
      try {
        const base64 = await readImageAsDataUrl(file);
        nextImages.push(base64);
      } catch (err) {
        console.error('Failed to process image:', err);
      }
    }
    if (nextImages.length > 0) {
      setReplyImages((prev) => [...prev, ...nextImages]);
    }
  }, [readImageAsDataUrl]);

  const handleReplyImageSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    void addReplyImageFiles(files);
    if (replyImageInputRef.current) {
      replyImageInputRef.current.value = '';
    }
  }, [addReplyImageFiles]);

  const addInputImageFiles = useCallback(async (files) => {
    const nextImages = [];
    for (const file of files) {
      if (!file || !file.type?.startsWith('image/')) continue;
      try {
        const base64 = await readImageAsDataUrl(file);
        nextImages.push(base64);
      } catch (err) {
        console.error('Failed to process image:', err);
      }
    }
    if (nextImages.length > 0) {
      setInputImages((prev) => [...prev, ...nextImages]);
    }
  }, [readImageAsDataUrl]);

  const handleInputImageSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    void addInputImageFiles(files);
    if (inputImageInputRef.current) {
      inputImageInputRef.current.value = '';
    }
  }, [addInputImageFiles]);

  const handleInputPaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void addInputImageFiles(imageFiles);
  }, [addInputImageFiles]);

  const handleInputDrop = useCallback((e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    const imageFiles = files.filter((file) => file.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void addInputImageFiles(imageFiles);
  }, [addInputImageFiles]);

  const handleInputDragOver = useCallback((e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  }, []);

  const handleReplyPaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void addReplyImageFiles(imageFiles);
  }, [addReplyImageFiles]);

  const handleReplyDrop = useCallback((e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    const imageFiles = files.filter((file) => file.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void addReplyImageFiles(imageFiles);
  }, [addReplyImageFiles]);

  const handleReplyDragOver = useCallback((e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  }, []);

  // 提交继续写
  const handleSubmitContinue = useCallback(async () => {
    if ((!replyText.trim() && replyImages.length === 0 && replyRefs.length === 0) || isReplying || !replyingThreadId) return;

    setIsReplying(true);
    try {
      const refLines = replyRefs.map((ref) => `[${ref.label}](${ref.href})`);
      const content = [replyText.trim(), ...refLines].filter(Boolean).join('\n');
      await onContinueThread?.(replyingThreadId, content, { images: replyImages });
      setReplyingThreadId(null);
      setReplyText('');
      setReplyImages([]);
      setReplyRefs([]);
    } catch (err) {
      console.error('Failed to continue thread:', err);
    } finally {
      setIsReplying(false);
    }
  }, [replyText, replyImages, replyRefs, isReplying, replyingThreadId, onContinueThread]);

  // 回复输入框的键盘事件
  const handleReplyKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmitContinue();
      } else if (e.key === 'Escape') {
        handleCancelContinue();
      }
    },
    [handleSubmitContinue, handleCancelContinue]
  );

  // AI 反思相关函数
  const handleStartReflect = useCallback(async (threadId, threadEntries) => {
    if (!isAIAvailable || isReflecting) return;

    setReflectingThreadId(threadId);
    setReflectionText('');
    setReflectionError('');
    setIsReflecting(true);

    try {
      await generateReflection(threadEntries, (token) => {
        setReflectionText(prev => prev + token);
      });
    } catch (err) {
      console.error('AI reflection failed:', err);
      setReflectionError(err?.message || t('idea.reflectError', 'AI 反思失败，请检查 AI 配置或稍后重试。'));
    } finally {
      setIsReflecting(false);
    }
  }, [isAIAvailable, isReflecting, generateReflection, t]);


  const handleSaveReflection = useCallback(async () => {
    if (!reflectionText.trim() || !reflectingThreadId) return;

    try {
      await onAddAIReflection?.(reflectingThreadId, reflectionText);
      setReflectingThreadId(null);
      setReflectionText('');
      setReflectionError('');
    } catch (err) {
      console.error('Failed to save AI reflection:', err);
    }
  }, [reflectionText, reflectingThreadId, onAddAIReflection]);

  const handleCancelReflection = useCallback(() => {
    setReflectingThreadId(null);
    setReflectionText('');
    setReflectionError('');
  }, []);

  const handleRequestDelete = useCallback((entryId, threadId) => {
    setPendingDelete({ entryId, threadId });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      await onDeleteEntry?.(pendingDelete.entryId, pendingDelete.threadId);
      setPendingDelete(null);
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  }, [onDeleteEntry, pendingDelete]);

  // 获取线程的所有 entries（用于 AI 反思）
  const getThreadEntries = useCallback((threadId) => {
    const entries = [];
    for (const group of allEntriesGrouped) {
      for (const entry of group.entries) {
        if (entry.threadId === threadId) {
          entries.push(entry);
        }
      }
    }
    return entries;
  }, [allEntriesGrouped]);

  const handleRetryReflection = useCallback((threadId) => {
    const entries = getThreadEntries(threadId);
    handleStartReflect(threadId, entries);
  }, [getThreadEntries, handleStartReflect]);

  // 注册日期 ref
  const setDateRef = useCallback((dateKey, el) => {
    if (el) {
      dateRefsMap.current.set(dateKey, el);
    } else {
      dateRefsMap.current.delete(dateKey);
    }
  }, []);

  const setEntryRef = useCallback((entryId, el) => {
    if (el) {
      entryRefsMap.current.set(entryId, el);
    } else {
      entryRefsMap.current.delete(entryId);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Header */}
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-50 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-zinc-500 font-medium">
          <span>{t('idea.title', '想法')}</span>
          <span>/</span>
          {boxLabel ? (
            <>
              <span className="text-gray-600 dark:text-zinc-400 uppercase tracking-wider text-xs">{boxLabel}</span>
              <span>/</span>
            </>
          ) : null}
          <span className="text-gray-900 dark:text-zinc-200 uppercase tracking-wider text-xs">
            {formatDateDisplay(selectedDate)}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onRefresh}
            className="p-1 text-gray-300 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
            title={t('common.refresh', 'Refresh')}
          >
            <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto py-12 px-6">
          {/* Capture Area */}
          <div className="mb-14 px-2">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              onPaste={handleInputPaste}
              onDrop={handleInputDrop}
              onDragOver={handleInputDragOver}
              className="w-full min-h-[40px] text-2xl font-medium text-gray-800 dark:text-zinc-200 placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none resize-none bg-transparent p-0"
              placeholder={t('idea.placeholder', "有什么新想法?")}
              rows={1}
              style={{ caretColor: '#71717a' }} // zinc-500
            />
            {inputImages.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {inputImages.map((src, idx) => (
                  <div key={`${src}-${idx}`} className="relative">
                    <img
                      src={src}
                      alt={`entry-image-${idx + 1}`}
                      className="h-16 w-16 object-cover rounded border border-gray-200 dark:border-zinc-700"
                    />
                    <button
                      type="button"
                      onClick={() => setInputImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1 -right-1 rounded-full bg-white dark:bg-zinc-800 shadow border border-gray-200 dark:border-zinc-700 p-[2px] text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200"
                      aria-label={t('common.remove', '移除')}
                    >
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {inputRefs.length > 0 && (
              <div className="mt-3 space-y-2">
                {inputRefs.map((ref, idx) => (
                  <div key={`${ref.href}-${idx}`} className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => handleRefClick(ref.href)}
                      className={styles.refCard}
                    >
                      <span className={`${styles.refCardIcon} ${ref.type === 'idea' ? styles.refCardIconIdea : styles.refCardIconDoc}`} />
                      <div className={styles.refCardContent}>
                        <div className={styles.refCardLabel}>
                          {ref.type === 'idea' ? t('pageRef.tabIdeas', 'Ideas') : t('pageRef.tabPages', 'Docs')}
                        </div>
                        <div className={styles.refCardTitle}>
                          {ref.label}
                        </div>
                        {ref.description && (
                          <div className={styles.refCardDesc}>
                            {ref.description}
                          </div>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputRefs((prev) => prev.filter((_, i) => i !== idx))}
                      className="mt-1 rounded-full border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-1 text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200"
                      aria-label={t('common.remove', '移除')}
                    >
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-2 pt-2">
              <div className="flex gap-3 text-gray-300 dark:text-zinc-600">
                <input
                  ref={inputImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleInputImageSelect}
                />
                <button
                  type="button"
                  onClick={() => inputImageInputRef.current?.click()}
                  className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 transition-colors"
                  title={t('common.addImage', '添加图片')}
                >
                  <PhotoIcon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRefTarget('main');
                    setIsPageRefOpen(true);
                  }}
                  className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 transition-colors"
                  title={t('pageRef.title', 'Reference page')}
                >
                  <span className="font-semibold text-base">@</span>
                </button>
              </div>
              <button
                onClick={handlePost}
                disabled={(!inputText.trim() && inputImages.length === 0 && inputRefs.length === 0) || isPosting}
                className="bg-gray-900 hover:bg-black dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white disabled:bg-gray-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 disabled:cursor-not-allowed text-white px-5 py-1.5 rounded-full text-sm font-medium transition-all shadow-sm active:scale-95"
              >
                {isPosting ? t('common.posting', '发布中...') : t('idea.post', '发布')}
              </button>
            </div>
          </div>

          {/* Stream - All entries grouped by date */}
          <div className="relative">
            {isLoading && totalEntries === 0 ? (
              <div className="pl-12 text-gray-400 italic">
                {t('common.loading', '加载中...')}
              </div>
            ) : totalEntries > 0 ? (
              <div className="space-y-0">
                {allEntriesGrouped.map(({ date, entries }) => (
                  <div 
                    key={date} 
                    ref={(el) => setDateRef(date, el)}
                    className="scroll-mt-4"
                  >
                    {/* Date Header */}
                    <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
                      <div className="text-[11px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
                        {formatDateDisplay(date)}
                      </div>
                      <div className="flex-1 h-[1px] bg-gray-100 dark:bg-zinc-800" />
                    </div>

                    {/* Entries for this date */}
                    <div className="space-y-0">
                      {entries.map((e) => (
                        <div 
                          key={e.id}
                          ref={(el) => setEntryRef(e.id, el)}
                          className={`${
                            animatedEntryId === e.id
                              ? 'animate-in fade-in slide-in-from-top-5 duration-200 ease-out'
                              : ''
                          } ${
                            e.isLastInThread && replyingThreadId !== e.threadId && reflectingThreadId !== e.threadId ? 'mb-6' : ''
                          }`}
                        >
                          <div className={`group ${styles.entryRow}`}>
                            {/* Left Column: Timeline & Ball */}
                            <div className={styles.leftCol}>
                              {/* Connection Line (Up) - Only if part of thread and not first */}
                              {!e.isFirstInThread && (
                                <div className={`${styles.lineTop} ${e.type === 'ai' ? styles.lineAi : styles.lineUser}`} />
                              )}
                              
                              {/* Connection Line (Down) - 检查下一个 entry 是否是 AI 来决定颜色 */}
                              {(() => {
                                // 找到当前 entry 在数组中的位置，检查下一个是否是 AI
                                const currentIndex = entries.findIndex(x => x.id === e.id);
                                const nextEntry = entries[currentIndex + 1];
                                const nextIsAI = nextEntry?.threadId === e.threadId && nextEntry?.type === 'ai';
                                const isReflecting = e.isLastInThread && reflectingThreadId === e.threadId;
                                
                                const showLine = !e.isLastInThread || (e.isLastInThread && (replyingThreadId === e.threadId || reflectingThreadId === e.threadId));
                                const lineColor = nextIsAI || isReflecting ? styles.lineAi : styles.lineUser;
                                
                                return showLine && (
                                  <div className={`${styles.lineBottom} ${lineColor}`} />
                                );
                              })()}

                              {/* Ball - 调大尺寸便于查看 */}
                              <div className={`${styles.ball} ${e.type === 'ai' ? styles.ballAi : styles.ballUser}`}>
                                {e.type === 'ai' && (
                                  <SparklesIcon className="w-3 h-3 text-orange-500 dark:text-orange-400" />
                                )}
                              </div>
                  </div>

                            {/* Right Column: Content */}
                            <div className={styles.entryRight}>
                  <div className={styles.entryHeader}>
                                <div className={styles.entryBody}>
                      <div
                                    className={`${styles.entryText} ${
                          e.type === 'ai' ? styles.entryTextAi : ''
                                    }`}
                      >
                        {renderEntryText(e)}
                      </div>
                      {e.images?.length > 0 && (
                        <div className={styles.entryImages}>
                          {e.images.map((src, idx) => (
                            <img
                              key={`${e.id}-image-${idx}`}
                              src={src}
                              alt={`entry-${e.id}-image-${idx + 1}`}
                              className={styles.entryImage}
                            />
                          ))}
                        </div>
                      )}

                                  {/* Thread Actions - 只在 hover 时显示 */}
                                  <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-gray-400 dark:text-zinc-500">
                                    {e.isLastInThread && replyingThreadId !== e.threadId && reflectingThreadId !== e.threadId && (
                                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 transition-opacity">
                            <button
                                          onClick={() => handleStartContinue(e.threadId)}
                                          className="text-gray-400 dark:text-zinc-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer"
                            >
                                          {t('idea.continue', '继续写')}
                            </button>
                                        <span className="text-gray-200 dark:text-zinc-700">·</span>
                                        <button 
                                          onClick={() => handleStartReflect(e.threadId, getThreadEntries(e.threadId))}
                                          disabled={!isAIAvailable || isReflecting}
                                          className="text-gray-400 dark:text-zinc-500 hover:text-orange-500 dark:hover:text-orange-400 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                          title={!isAIAvailable ? t('idea.aiNotConfigured', 'AI 未配置，请前往设置页面配置') : ''}
                                        >
                                          <SparklesIcon className="w-3 h-3" />
                                          <span>{t('idea.reflect', 'AI思考')}</span>
                            </button>
                                        {onRequestMoveThread ? (
                                          <>
                                            <span className="text-gray-200 dark:text-zinc-700">·</span>
                                            <button
                                              onClick={() => onRequestMoveThread({ threadId: e.threadId, threadTitle: e.threadTitle })}
                                              className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                                            >
                                              {t('idea.moveThread', '移动')}
                                            </button>
                                          </>
                                        ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                                {/* Timestamp */}
                                <div className={`flex items-center gap-2 ${styles.entryMeta}`}>
                                  {pendingDelete?.entryId === e.id ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={handleConfirmDelete}
                                        className="text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                      >
                                        {t('common.delete', '删除')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={handleCancelDelete}
                                        className="text-gray-400 hover:text-gray-500 dark:text-zinc-500 dark:hover:text-zinc-400 transition-colors"
                                      >
                                        {t('common.cancel', '取消')}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleRequestDelete(e.id, e.threadId)}
                                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                                        title={t('common.delete', '删除')}
                                      >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                      </button>
                                      <span>{formatRelativeTime(e.createdAt)}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Inline Reply Input - 显示在最后一个 entry 下方 */}
                          {e.isLastInThread && replyingThreadId === e.threadId && (
                            <div className="flex gap-4 animate-in fade-in slide-in-from-top-4 duration-200">
                              {/* Left Column: Timeline connector */}
                              <div className={styles.leftCol}>
                                {/* Connection Line (Up) */}
                                <div className={`${styles.lineTop} ${styles.lineUser}`} />
                                {/* Ball for new entry */}
                                <div className={`${styles.ball} ${styles.ballReply}`} />
                              </div>

                              {/* Right Column: Input */}
                              <div className="flex-1 min-w-0 pb-8">
                                <div className="relative">
                                  <textarea
                                    ref={replyInputRef}
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    onKeyDown={handleReplyKeyDown}
                                    onPaste={handleReplyPaste}
                                    onDrop={handleReplyDrop}
                                    onDragOver={handleReplyDragOver}
                                    className="w-full min-h-[24px] text-[15px] leading-relaxed text-gray-900 dark:text-zinc-200 placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none resize-none bg-transparent p-0"
                                    placeholder={t('idea.continuePlaceholder', '继续这个想法...')}
                                    rows={1}
                                    style={{ height: 'auto', minHeight: '24px' }}
                                    onInput={(e) => {
                                      e.target.style.height = 'auto';
                                      e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                  />
                                  {replyImages.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {replyImages.map((src, idx) => (
                                        <div key={`${src}-${idx}`} className="relative">
                                          <img
                                            src={src}
                                            alt={`reply-image-${idx + 1}`}
                                            className="h-16 w-16 object-cover rounded border border-gray-200 dark:border-zinc-700"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setReplyImages((prev) => prev.filter((_, i) => i !== idx))}
                                            className="absolute -top-1 -right-1 rounded-full bg-white dark:bg-zinc-800 shadow border border-gray-200 dark:border-zinc-700 p-[2px] text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200"
                                            aria-label={t('common.remove', '移除')}
                                          >
                                            <XMarkIcon className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {replyRefs.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                      {replyRefs.map((ref, idx) => (
                                        <div key={`${ref.href}-${idx}`} className="flex items-start gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleRefClick(ref.href)}
                                            className={styles.refCard}
                                          >
                                            <span className={`${styles.refCardIcon} ${ref.type === 'idea' ? styles.refCardIconIdea : styles.refCardIconDoc}`} />
                                            <div className={styles.refCardContent}>
                                              <div className={styles.refCardLabel}>
                                                {ref.type === 'idea' ? t('pageRef.tabIdeas', 'Ideas') : t('pageRef.tabPages', 'Docs')}
                                              </div>
                                              <div className={styles.refCardTitle}>
                                                {ref.label}
                                              </div>
                                              {ref.description && (
                                                <div className={styles.refCardDesc}>
                                                  {ref.description}
                                                </div>
                                              )}
                                            </div>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setReplyRefs((prev) => prev.filter((_, i) => i !== idx))}
                                            className="mt-1 rounded-full border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-1 text-gray-400 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-200"
                                            aria-label={t('common.remove', '移除')}
                                          >
                                            <XMarkIcon className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between mt-2">
                                    <span className="text-[10px] text-gray-300 dark:text-zinc-600 font-medium select-none">
                                      {t('idea.continueHint', 'Enter 保存 · Esc 取消')}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <input
                                        ref={replyImageInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleReplyImageSelect}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => replyImageInputRef.current?.click()}
                                        className="text-gray-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400 transition-colors p-1"
                                        title={t('common.addImage', '添加图片')}
                                      >
                                        <PhotoIcon className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRefTarget('reply');
                                          setIsPageRefOpen(true);
                                        }}
                                        className="text-gray-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400 transition-colors p-1"
                                        title={t('pageRef.title', 'Reference')}
                                      >
                                        <span className="text-sm font-semibold">@</span>
                                      </button>
                                      <button
                                        onClick={handleSubmitContinue}
                                        disabled={(!replyText.trim() && replyImages.length === 0 && replyRefs.length === 0) || isReplying}
                                        className="text-gray-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400 disabled:text-gray-200 dark:disabled:text-zinc-700 transition-colors p-1"
                                        title={t('common.save', '保存')}
                                      >
                                        {isReplying ? (
                                           <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                        ) : (
                                           <PaperAirplaneIcon className="w-4 h-4" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* AI Reflection - 显示在最后一个 entry 下方 */}
                          {e.isLastInThread && reflectingThreadId === e.threadId && (
                            <div className={`flex gap-4 animate-in fade-in slide-in-from-top-4 duration-200 ${styles.entryRow}`}>
                              {/* Left Column: Timeline connector */}
                              <div className={styles.leftCol}>
                                {/* Connection Line (Up) - 连接到上面的 entry */}
                                <div className={`${styles.lineTop} ${styles.lineAi}`} />
                                {/* AI Ball - 与普通 entry 保持对齐 */}
                                <div className={`${styles.ball} ${styles.ballAi} ${isReflecting ? 'animate-pulse' : ''}`}>
                                  <SparklesIcon className="w-3 h-3 text-orange-500 dark:text-orange-400" />
                                </div>
                                {/* 不需要向下的连接线，AI 反思是 thread 的终点 */}
                              </div>

                              {/* Right Column: AI Response */}
                              <div className={styles.entryRight}>
                                <div className={styles.entryHeader}>
                                  <div className={styles.entryBody}>
                                    <div className="relative pt-1">
                                      {isReflecting && !reflectionText && (
                                        <div className="flex items-center gap-2 !text-[14px] text-gray-400 dark:text-zinc-500">
                                          <ArrowPathIcon className="w-4 h-4 animate-spin text-orange-500 dark:text-orange-400" />
                                          <span>{t('idea.reflecting', 'AI 正在思考...')}</span>
                                        </div>
                                      )}
                                      {reflectionError && !isReflecting && (
                                        <div className="space-y-2">
                                          <div className="flex items-start gap-2 text-[13px] text-red-500">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mt-1" />
                                            <span className="whitespace-pre-wrap break-words">{reflectionError}</span>
                                          </div>
                                          <div className="flex items-center gap-3">
                                            <button
                                              type="button"
                                              onClick={() => handleRetryReflection(e.threadId)}
                                              className="text-[12px] text-blue-500 hover:text-blue-700 font-medium transition-colors"
                                            >
                                              {t('idea.retry', '重试')}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={handleCancelReflection}
                                              className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                                            >
                                              {t('common.cancel', '取消')}
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                      {/* 生成中：只读显示 + 光标动画 */}
                                      {reflectionText && isReflecting && (
                                        <div className="!text-[14px] leading-[1.6] text-gray-500 dark:text-zinc-400 whitespace-pre-wrap break-words">
                                          {reflectionText}
                                          <span className="inline-block w-1.5 h-4 bg-orange-400 ml-0.5 animate-pulse" />
                                        </div>
                                      )}
                                      {/* 生成完成：可编辑 textarea */}
                                      {!isReflecting && !reflectionError && (
                                        <>
                                          <textarea
                                            ref={reflectionInputRef}
                                            value={reflectionText}
                                            onChange={(e) => setReflectionText(e.target.value)}
                                            className="w-full min-h-0 !text-[14px] leading-[1.6] text-gray-500 dark:text-zinc-400
                                              placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none 
                                              resize-none bg-transparent p-0"
                                            style={{ height: 'auto', minHeight: '0px' }}
                                            onInput={(e) => {
                                              e.target.style.height = 'auto';
                                              e.target.style.height = e.target.scrollHeight + 'px';
                                            }}
                                          />
                                          <div className="flex items-center justify-between mt-3">
                                            <span className="text-[10px] text-gray-300 dark:text-zinc-600 font-medium select-none">
                                              {t('idea.reflectionEditable', '可编辑 AI 内容')}
                                            </span>
                                            <div className="flex items-center gap-2">
                                              <button
                                                onClick={handleCancelReflection}
                                                className="text-[11px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
                                              >
                                                {t('common.cancel', '取消')}
                                              </button>
                                              <button
                                                onClick={handleSaveReflection}
                                                disabled={!reflectionText.trim()}
                                                className="text-[11px] text-orange-500 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                                              >
                                                <PaperAirplaneIcon className="w-3 h-3" />
                                                {t('common.save', '保存')}
                                              </button>
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className={styles.entryMeta} />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
            ) : (
              <div className="pl-12 text-gray-400 dark:text-zinc-500 italic">
                {t('idea.empty', '还没有想法，开始记录吧！')}
              </div>
            )}
          </div>
        </div>
      </div>
      {isPageRefOpen && (
        <PageRefPicker
          docMeta={null}
          onSelect={insertDocRef}
          onSelectIdea={insertIdeaRef}
          onClose={() => setIsPageRefOpen(false)}
        />
      )}
    </div>
  );
}
