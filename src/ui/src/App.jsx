import { useEffect, useMemo, useRef, useState, useCallback, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ROUTES } from './routes';
import { 
  ArrowPathIcon,
  InboxIcon, 
  TrashIcon, 
  FolderIcon,
  PencilIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
// Tiptap Editor (migrated from PlateJS)
import { TiptapMarkdownEditor, TiptapMarkdownViewer } from './components/TiptapMarkdown';
// Legacy PlateJS (kept for reference, can be removed later)
// import { PlateMarkdownEditor, PlateMarkdownViewer } from './components/PlateMarkdown';
import { Breadcrumbs } from './components/Breadcrumbs';
import { CustomDialog, ContextMenu } from './components/Dialogs';
import { SidebarTree } from './components/SidebarTree';
import { Toc } from './components/Toc';
import { SearchModal, useSearchShortcut } from './components/SearchModal';
import { useFolderCache } from './hooks/useFolderCache';
import { useDocLoader } from './hooks/useDocLoader';
import { useIdeaLoader } from './hooks/useIdeaLoader';
import { useScrollSpy } from './hooks/useScrollSpy';
import { useTauriDrag } from './hooks/useTauriDrag.jsx';
import { PageSkeleton, SidebarSkeleton } from './components/Skeletons';
import IdeaTimeline from './components/IdeaTimeline';
import * as api from './api';
import { writeClipboardText } from './utils/clipboard';
import {
  moveDocFlow,
  moveFolderFlow,
  rewriteExpandedFolders,
  rewriteFolderDocsCache,
  rewriteSelectedDocAfterFolderMove,
  isDescendantPath,
} from './services/move';
import { basename, dirname } from './utils/path';
import IdeaTimelineDemo from './demo/IdeaTimelineDemo';

// Notion-like Styles
const BASE_DOCUMENT_CLASSES = [
  'prose',
  'prose-zinc',
  'dark:prose-invert',
  'max-w-none',
  // Headings
  'prose-headings:text-gray-900',
  'prose-headings:font-semibold',
  'dark:prose-headings:text-zinc-100',
  'prose-h1:text-4xl',
  'prose-h1:font-bold',
  'prose-h1:mb-4',
  'prose-h2:text-2xl',
  'prose-h2:mt-8',
  'prose-h2:mb-4',
  'prose-h3:text-xl',
  'prose-h3:mt-6',
  'prose-h3:mb-2',
  // Text
  'prose-p:text-gray-700',
  'prose-p:leading-7',
  'prose-p:my-2',
  'dark:prose-p:text-zinc-300',
  // Lists
  'prose-li:text-gray-700',
  'prose-ul:my-2',
  'prose-ol:my-2',
  'dark:prose-li:text-zinc-300',
  // Code
  'prose-code:text-red-500',
  'prose-code:bg-gray-100',
  'prose-code:px-1',
  'prose-code:py-0.5',
  'prose-code:rounded-md',
  'prose-code:before:content-none',
  'prose-code:after:content-none',
  'prose-pre:bg-gray-100',
  'prose-pre:text-gray-800',
  'prose-pre:border',
  'prose-pre:border-gray-200',
  'dark:prose-code:text-rose-300',
  'dark:prose-code:bg-zinc-800',
  'dark:prose-pre:bg-zinc-900',
  'dark:prose-pre:text-zinc-200',
  'dark:prose-pre:border-zinc-700',
  // Links
  'prose-a:text-gray-600',
  'prose-a:underline',
  'prose-a:decoration-gray-300',
  'hover:prose-a:text-blue-600',
  'dark:prose-a:text-zinc-300',
  'dark:prose-a:decoration-zinc-600',
  'dark:hover:prose-a:text-cyan-300',
  'transition-colors',
  // Blockquote
  'prose-blockquote:border-l-4',
  'prose-blockquote:border-gray-300',
  'prose-blockquote:pl-4',
  'prose-blockquote:italic',
  'prose-blockquote:text-gray-600',
  'dark:prose-blockquote:border-zinc-600',
  'dark:prose-blockquote:text-zinc-400'
].join(' ');

const EDITOR_CONTENT_CLASSES = `${BASE_DOCUMENT_CLASSES} w-full min-h-[calc(100vh-12rem)] px-12 py-8 focus:outline-none focus-visible:outline-none`;
const AUTO_SAVE_DELAY = 1500;

// Helper: Generate opencontext-citation block for a document (metadata only, no content)
function generateDocCitation(doc) {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  const absPath = doc.abs_path || doc.absPath || '';
  const relPath = doc.rel_path || '';
  const stableId = doc.stable_id || doc.stableId || '';
  const description = doc.description || '';
  
  return `\`\`\`opencontext-citation
source: opencontext
kind: file
abs_path: ${absPath}
rel_path: ${relPath}
stable_id: ${stableId}
copied_at: ${timestamp}
description: ${description}
note: This is a reference to an OpenContext document. Load the file via abs_path using read_file tool to get the content.
\`\`\``;
}

// Helper: Generate opencontext-citation block for a folder/directory
function generateFolderCitation(folder, docs) {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  const absPath = folder.abs_path || folder.absPath || '';
  
  // Generate a docs list
  const docsList = (docs || []).map(d => {
    const name = (d.rel_path || d.name || '').split('/').pop();
    const desc = d.description ? `: ${d.description.slice(0, 80)}${d.description.length > 80 ? '...' : ''}` : '';
    return `  - ${name}${desc}`;
  }).join('\n');
  
  return `\`\`\`opencontext-citation
source: opencontext
kind: directory
abs_path: ${absPath}
rel_path: ${folder.rel_path || folder.path || ''}
copied_at: ${timestamp}
note: This is a reference to an OpenContext directory. Load files via their abs_path or use \`oc context manifest ${folder.rel_path || folder.path || '<folder>'}\` for detailed information.
docs: |
${docsList || '  (empty)'}
\`\`\``; 
}

// Generic Input Modal (Create/Rename) -> Now replaced by CustomDialog, but keeping for compatibility if needed or removed entirely.
// Actually, let's remove InputModal and use CustomDialog for input too to unify.
// But wait, the original code used InputModal heavily. I will replace it with CustomDialog in the implementation.

// Save state reducer - stores i18n keys instead of translated strings
const saveInitialState = { hasPendingChanges: false, saveState: 'idle', saveMessageKey: 'save.synced' };
function saveReducer(state, action) {
  switch (action.type) {
    case 'LOAD_DOC_RESET':
      return { ...state, hasPendingChanges: false, saveState: 'idle', saveMessageKey: 'save.synced' };
    case 'CONTENT_SYNCED':
      return { ...state, hasPendingChanges: false, saveState: 'idle', saveMessageKey: 'save.synced' };
    case 'CONTENT_CHANGED':
      return { ...state, hasPendingChanges: true, saveState: 'pending', saveMessageKey: 'save.unsaved' };
    case 'SAVE_START':
      return { ...state, saveState: 'saving', saveMessageKey: 'save.saving' };
    case 'SAVE_SUCCESS':
      return { ...state, hasPendingChanges: false, saveState: 'success', saveMessageKey: action.messageKey || 'save.synced' };
    case 'SAVE_ERROR':
      return { ...state, saveState: 'error', saveMessageKey: action.messageKey || 'save.failed', errorMessage: action.errorMessage };
    default:
      return state;
  }
}

import { Settings } from './components/Settings';

export default function App() {
  // Demo switch: render Idea Timeline demo when ?demo=idea is present.
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('demo') === 'idea') {
      return <IdeaTimelineDemo />;
    }
  }

  const { t } = useTranslation();
  const { DragRegion, dragProps } = useTauriDrag();
  
  // React Router hooks
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const ideaBoxParam = useMemo(() => {
    const searchParams = new URLSearchParams(location.search || '');
    return searchParams.get('box') || '';
  }, [location.search]);
  
  // 根据路由路径确定当前视图
  const view = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/idea')) return 'idea';
    if (path === '/settings') return 'settings';
    return 'editor';
  }, [location.pathname]);
  const [toc, setToc] = useState([]);
  const [isTocOpen, setIsTocOpen] = useState(true);
  const editorRef = useRef(null); // ref for TiptapMarkdownEditor
  const [error, setError] = useState('');
  const [save, dispatchSave] = useReducer(saveReducer, saveInitialState);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [ideaFocusEntryId, setIdeaFocusEntryId] = useState(null);
  // activeTocId is computed by useScrollSpy

  // UI States
  const [contextMenu, setContextMenu] = useState(null); // { x, y, target }
  // dialog state replaces modal state
  const [dialog, setDialog] = useState(null); // { isOpen, type, title, message, placeholder, initialValue, confirmText, cancelText, isDestructive, kind, payload }
  // Search modal state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  // Global keyboard shortcut for search (⌘K)
  useSearchShortcut(() => setIsSearchOpen(true));

  const autoSaveTimerRef = useRef(null);
  const saveDocumentRef = useRef(null);
  const lastIdeaBoxParamRef = useRef(ideaBoxParam);

  const folderError = useCallback(
    (err) => {
      setDialog({ isOpen: true, type: 'alert', title: t('error.refreshFailed'), message: err.message, kind: 'ALERT' });
    },
    [setDialog, t],
  );

  const {
    folders,
    setFolders,
    folderDocs,
    setFolderDocs,
    expandedFolders,
    setExpandedFolders,
    foldersLoaded,
    refreshFolder,
    toggleFolder,
    refreshSidebarAll,
    refreshSidebarForSpace,
  } = useFolderCache({ api, onError: folderError });

  const beforeLoadDoc = useCallback(async () => {
    if (!save.hasPendingChanges) return true;
    const fn = saveDocumentRef.current;
    if (typeof fn !== 'function') return true;
    return fn('switch');
  }, [save.hasPendingChanges]);

  const onAfterLoadDoc = useCallback(() => {
    dispatchSave({ type: 'LOAD_DOC_RESET' });
  }, []);

  const {
    selectedDoc,
    setSelectedDoc,
    docContent,
    setDocContent,
    isLoadingContent,
    diffGate,
    setDiffGate,
    spaceNewDocs,
    setSpaceNewDocs,
    currentSpace,
    editorScrollRef,
    isHydratingContentRef,
    lastSavedContentRef,
    openDocByStableId,
    loadDocRaw: loadDoc,
    ensureLatestBeforeEdit,
    clearSelection,
  } = useDocLoader({
    api,
    foldersLoaded,
    expandedFolders,
    setExpandedFolders,
    folderDocs,
    refreshFolder,
    hasPendingChanges: save.hasPendingChanges,
    beforeLoadDoc,
    onAfterLoadDoc,
    setError,
    onAlert: (title, message) => setDialog({ isOpen: true, type: 'alert', title: title || t('error.operationFailed'), message, kind: 'ALERT' }),
  });

  // Toc anchors provided by Tiptap TableOfContents extension
  const { activeId: activeTocId, scrollToId } = useScrollSpy({ containerRef: editorScrollRef, toc });
  const scrollToTocHeading = useCallback(
    (heading) => {
      if (!heading) return;
      // Use editor's scrollToPos if available (from TableOfContents anchors)
      if (typeof heading.pos === 'number' && editorRef.current?.scrollToPos) {
        editorRef.current.scrollToPos(heading.pos);
        return;
      }
      // Fallback to id-based scroll
      if (heading.id) {
        scrollToId(heading.id);
      }
    },
    [scrollToId]
  );
  const handleTocUpdate = useCallback((anchors = []) => {
    // anchors: [{ id, text, level, pos, isActive }]
    setToc(
      anchors.map((a, idx) => ({
        id: a.id || `heading-${idx}`,
        text: a.text || '',
        level: a.level || a.originalLevel || 1,
        pos: a.pos, // position in document for scrolling
      })),
    );
  }, []);

  // Idea module
  const ideaLoader = useIdeaLoader({ api });
  const buildIdeaRoute = useCallback((box, date) => {
    const safeBox = box ? encodeURIComponent(box) : '';
    const base = date ? ROUTES.IDEA_DATE(date) : ROUTES.IDEA;
    return safeBox ? `${base}?box=${safeBox}` : base;
  }, []);
  const extractIdeaBox = useCallback((threadId) => {
    if (!threadId) return 'inbox';
    const normalized = threadId.startsWith('.ideas/') ? threadId.slice('.ideas/'.length) : threadId;
    const first = normalized.split('/').filter(Boolean)[0] || '';
    if (/^\d{4}$/.test(first)) return 'inbox';
    return first || 'inbox';
  }, []);
  const openDocFromRef = useCallback((stableId, meta) => {
    navigate(ROUTES.HOME);
    openDocByStableId(stableId, meta);
  }, [navigate, openDocByStableId]);
  const openIdeaRef = useCallback((ref) => {
    if (!ref) return;
    const date = String(ref.date || '').trim();
    const box = extractIdeaBox(ref.threadId || '');
    if (box) {
      ideaLoader.setSelectedBox(box);
    }
    if (date) {
      ideaLoader.setSelectedDate(date);
      navigate(buildIdeaRoute(box, date));
    } else {
      navigate(buildIdeaRoute(box));
    }
    if (ref.entryId) {
      setIdeaFocusEntryId(ref.entryId);
    }
  }, [buildIdeaRoute, extractIdeaBox, ideaLoader, navigate]);

  // 当切换到非编辑器视图时，清除文档选中状态
  // 使用 ref 追踪上一次的 view，避免不必要的更新和循环
  const prevViewRef = useRef(view);
  useEffect(() => {
    const prevView = prevViewRef.current;
    prevViewRef.current = view;
    
    // 只在从 editor 切换到其他视图时清除选中状态
    if (prevView === 'editor' && view !== 'editor') {
      clearSelection();
    }
  }, [view, clearSelection]);

  // 同步路由参数中的日期到 ideaLoader
  useEffect(() => {
    if (view === 'idea' && params.date) {
      ideaLoader.setSelectedDate(params.date);
    }
  }, [view, params.date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== 'idea') return;
    if (ideaBoxParam === lastIdeaBoxParamRef.current) return;
    lastIdeaBoxParamRef.current = ideaBoxParam;
    if (ideaBoxParam && ideaBoxParam !== ideaLoader.selectedBox) {
      ideaLoader.setSelectedBox(ideaBoxParam);
    }
  }, [ideaBoxParam, ideaLoader.selectedBox, ideaLoader.setSelectedBox, view]);

  // Sidebar Resize Logic (Same as before)
  const startResizing = useCallback((e) => { e.preventDefault(); setIsResizingSidebar(true); }, []);
  const stopResizing = useCallback(() => { setIsResizingSidebar(false); }, []);
  const resize = useCallback((e) => { if (isResizingSidebar) { const w = e.clientX; if (w > 160 && w < 600) setSidebarWidth(w); } }, [isResizingSidebar]);
  useEffect(() => { window.addEventListener('mousemove', resize); window.addEventListener('mouseup', stopResizing); return () => { window.removeEventListener('mousemove', resize); window.removeEventListener('mouseup', stopResizing); }; }, [resize, stopResizing]);

  // --- CRUD Handlers ---

  // Context Menu
  const handleContextMenu = (e, target) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  };

  // Actions
  const handleCreatePageAction = (folderPath = '') => {
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('dialog.newPage.title'),
      placeholder: t('dialog.newPage.placeholder'),
      initialValue: folderPath ? `${folderPath}/` : '',
      kind: 'CREATE_PAGE',
      payload: { folderPath }
    });
  };

  const handleCreateFolderAction = (folderPath = '') => {
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('dialog.newFolder.title'),
      placeholder: t('dialog.newFolder.placeholder'),
      initialValue: folderPath ? `${folderPath}/` : '',
      kind: 'CREATE_FOLDER',
      payload: { folderPath }
    });
  };

  const handleCreateIdeaBoxAction = () => {
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('idea.boxCreateTitle', 'New Ideas Box'),
      placeholder: t('idea.boxCreatePlaceholder', 'Box name'),
      kind: 'CREATE_IDEA_BOX',
    });
  };

  const handleRenameIdeaBoxAction = (box) => {
    if (!box) return;
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('idea.boxRenameTitle', 'Rename Ideas Box'),
      placeholder: t('idea.boxRenamePlaceholder', 'New name'),
      initialValue: box,
      kind: 'RENAME_IDEA_BOX',
      payload: { box },
    });
  };

  const handleDeleteIdeaBoxAction = (box) => {
    if (!box) return;
    setDialog({
      isOpen: true,
      type: 'confirm',
      title: t('idea.boxDeleteTitle', 'Delete Ideas Box'),
      message: t('idea.boxDeleteMessage', { name: box }),
      isDestructive: true,
      confirmText: t('dialog.deleteItem.confirmText'),
      kind: 'DELETE_IDEA_BOX',
      payload: { box },
    });
  };

  const handleMoveIdeaThreadAction = (thread) => {
    if (!thread?.threadId) return;
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('idea.moveThreadTitle', 'Move thread to box'),
      message: t('idea.moveThreadMessage', { name: thread.threadTitle || thread.threadId }),
      placeholder: t('idea.moveThreadPlaceholder', 'Target box name'),
      initialValue: ideaLoader.selectedBox || '',
      confirmText: t('common.move', 'Move'),
      kind: 'MOVE_IDEA_THREAD',
      payload: { threadId: thread.threadId },
    });
  };

  const handleMoveDocAction = (doc) => {
    if (!doc?.rel_path) return;
    const currentDir = dirname(doc.rel_path);
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('dialog.move.pageTitle'),
      message: t('dialog.move.confirmMessage', { name: doc.rel_path, target: '...' }),
      placeholder: t('dialog.move.placeholder'),
      initialValue: currentDir,
      kind: 'MOVE_DOC',
      payload: { docRelPath: doc.rel_path }
    });
  };

  const handleMoveFolderAction = (folder) => {
    const folderPath = folder?.path || folder?.rel_path;
    if (!folderPath) return;
    const currentParent = dirname(folderPath);
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('dialog.move.folderTitle'),
      message: t('dialog.move.confirmMessage', { name: folderPath, target: '...' }),
      placeholder: t('dialog.move.placeholder'),
      initialValue: currentParent,
      kind: 'MOVE_FOLDER',
      payload: { sourcePath: folderPath }
    });
  };

  const handleRenameAction = (item) => {
    const currentPath = item.rel_path || item.path;
    // Only show the name part for renaming, not the full path
    const currentName = basename(currentPath);
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('dialog.rename.title'),
      placeholder: t('dialog.rename.placeholder'),
      initialValue: currentName,
      kind: 'RENAME',
      payload: { item }
    });
  };

  const handleEditDescriptionAction = (doc) => {
    if (!doc?.rel_path) return;
    setDialog({
      isOpen: true,
      type: 'prompt_multiline',
      title: t('dialog.editDescription.title'),
      message: t('dialog.editDescription.message'),
      placeholder: t('dialog.editDescription.placeholder'),
      initialValue: doc.description || '',
      confirmText: t('common.save'),
      kind: 'SET_DESCRIPTION',
      payload: { docRelPath: doc.rel_path }
    });
  };


  const handleDeleteAction = (item) => {
    setDialog({
      isOpen: true,
      type: 'confirm',
      title: t('dialog.deleteItem.title'),
      message: t('dialog.deleteItem.message', { name: item.rel_path || item.path }),
      isDestructive: true,
      confirmText: t('dialog.deleteItem.confirmText'),
      kind: 'DELETE_ITEM',
      payload: { item }
    });
  };

  // Copy Citation for Document (metadata only, LLM will read content via abs_path)
  const handleCopyDocCitation = async (doc) => {
    if (!doc?.rel_path) return;
    try {
      // Get full doc meta (including abs_path, stable_id)
      const meta = await api.getDocMeta(doc.rel_path);
      const citation = generateDocCitation(meta);
      await writeClipboardText(citation);
      setDialog({ isOpen: true, type: 'alert', title: t('error.copied'), message: t('citation.docCopied'), kind: 'ALERT' });
    } catch (err) {
      setDialog({ isOpen: true, type: 'alert', title: t('error.copyFailed'), message: err.message, kind: 'ALERT' });
    }
  };

  // Copy Citation for Folder
  const handleCopyFolderCitation = async (folder) => {
    if (!folder?.path && !folder?.rel_path) return;
    const folderPath = folder.path || folder.rel_path;
    try {
      // Get docs in this folder
      const docs = await api.listDocs(folderPath, false);
      // Build folder info with abs_path
      const folderInfo = {
        ...folder,
        abs_path: folder.abs_path || '',
        rel_path: folderPath
      };
      // If abs_path is missing, try to construct it (best effort)
      if (!folderInfo.abs_path) {
        // Try to get from first doc or leave empty
        const firstDoc = docs[0];
        if (firstDoc?.abs_path) {
          const docAbsPath = firstDoc.abs_path;
          const docRelPath = firstDoc.rel_path || '';
          const docName = docRelPath.split('/').pop();
          folderInfo.abs_path = docAbsPath.replace(`/${docName}`, '');
        }
      }
      const citation = generateFolderCitation(folderInfo, docs);
      await writeClipboardText(citation);
      setDialog({ isOpen: true, type: 'alert', title: t('error.copied'), message: t('citation.folderCopied'), kind: 'ALERT' });
    } catch (err) {
      setDialog({ isOpen: true, type: 'alert', title: t('error.copyFailed'), message: err.message, kind: 'ALERT' });
    }
  };

  const performDelete = async (item) => {
    try {
      if (item.type === 'folder') {
        await api.removeFolder(item.path, true); // force delete
        // Refresh root to rebuild tree
        const data = await api.listFolders({ all: true });
        setFolders(data);
      } else {
        await api.removeDoc(item.rel_path);
        if (selectedDoc?.rel_path === item.rel_path) {
          setSelectedDoc(null); setDocContent('');
        }
        // Refresh parent folder
        const parentPath = dirname(item.rel_path);
        await refreshFolder(parentPath);
      }
    } catch (err) { 
      setDialog({ isOpen: true, type: 'alert', title: t('common.error'), message: err.message, kind: 'ALERT' });
    }
  };

  const handleDialogConfirm = async (value) => {
    const kind = dialog?.kind;
    const payload = dialog?.payload || {};
    if (!kind) return;

    try {
      if (kind === 'CREATE_PAGE') {
        const v = String(value || '').trim();
        if (!v) return;
        const parts = v.split('/');
        const fileName = parts.pop();
        const folderPath = parts.join('/');
        const relPath = folderPath ? `${folderPath}/${fileName}` : fileName;

        // 确保父级文件夹存在
        if (folderPath) {
          let current = '';
          for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            // eslint-disable-next-line no-await-in-loop
            await api.createFolder(current, '').catch(() => {});
          }
        }

        // 创建文档
        await api.createDoc(folderPath, fileName, '');

        // 刷新侧边栏
        const data = await api.listFolders({ all: true });
        setFolders(data);
        if (folderPath) await refreshFolder(folderPath);

        // 默认选中新建的文档
        await loadDoc(
          {
            rel_path: relPath,
            description: '',
            updated_at: new Date().toISOString(),
          },
          { urlMode: 'push' },
        );
        return;
      }

      if (kind === 'CREATE_FOLDER') {
        const v = String(value || '').trim();
        if (!v) return;
        await api.createFolder(v, '');
        const data = await api.listFolders({ all: true });
        setFolders(data);
        return;
      }

      if (kind === 'CREATE_IDEA_BOX') {
        const v = String(value || '').trim();
        if (!v) return;
        if (v.includes('/') || v.includes('\\')) {
          throw new Error(t('dialog.rename.invalidName') || 'Name cannot contain path separators');
        }
        const boxName = await ideaLoader.createBox(v);
        navigate(buildIdeaRoute(boxName, ideaLoader.selectedDate));
        return;
      }

      if (kind === 'MOVE_DOC') {
        const destFolderPath = String(value || '').trim();
        const docRelPath = payload.docRelPath;
        const res = await moveDocFlow({ api, docRelPath, targetFolderPath: destFolderPath });
        setFolders(res.folders);
        if (res.oldParentPath) await refreshFolder(res.oldParentPath);
        if (res.targetFolderPath) await refreshFolder(res.targetFolderPath);
        if (selectedDoc?.rel_path === docRelPath) {
          setSelectedDoc((prev) => (prev ? { ...prev, rel_path: res.newRelPath } : prev));
        }
        return;
      }

      if (kind === 'CONFIRM_MOVE_DOC') {
        const docRelPath = payload.docRelPath;
        const targetFolderPath = payload.targetFolderPath;
        const res = await moveDocFlow({ api, docRelPath, targetFolderPath });
        setFolders(res.folders);
        if (res.oldParentPath) await refreshFolder(res.oldParentPath);
        if (res.targetFolderPath) await refreshFolder(res.targetFolderPath);
        if (selectedDoc?.rel_path === docRelPath) {
          setSelectedDoc((prev) => (prev ? { ...prev, rel_path: res.newRelPath } : prev));
        }
        return;
      }

      if (kind === 'MOVE_FOLDER') {
        const destFolderPath = String(value || '').trim();
        const sourcePath = payload.sourcePath;
        const res = await moveFolderFlow({ api, sourcePath, targetFolderPath: destFolderPath });
        setFolders(res.folders);
        setFolderDocs((prev) => rewriteFolderDocsCache(prev, sourcePath, res.newPath));
        setExpandedFolders((prev) => rewriteExpandedFolders(prev, sourcePath, res.newPath, res.targetFolderPath));
        setSelectedDoc((prev) => rewriteSelectedDocAfterFolderMove(prev, sourcePath, res.newPath));
        return;
      }

      if (kind === 'CONFIRM_MOVE_FOLDER') {
        const sourcePath = payload.sourcePath;
        const targetFolderPath = payload.targetFolderPath;
        const res = await moveFolderFlow({ api, sourcePath, targetFolderPath });
        setFolders(res.folders);
        setFolderDocs((prev) => rewriteFolderDocsCache(prev, sourcePath, res.newPath));
        setExpandedFolders((prev) => rewriteExpandedFolders(prev, sourcePath, res.newPath, res.targetFolderPath));
        setSelectedDoc((prev) => rewriteSelectedDocAfterFolderMove(prev, sourcePath, res.newPath));
        return;
      }

      if (kind === 'RENAME') {
        const newName = String(value || '').trim();
        if (!newName) return;
        // Validate: name should not contain path separators
        if (newName.includes('/') || newName.includes('\\')) {
          throw new Error(t('dialog.rename.invalidName') || 'Name cannot contain path separators');
        }
        
        const item = payload.item;
        const oldPath = item?.rel_path || item?.path;
        if (!oldPath) return;
        const oldDir = dirname(oldPath);

        if (item?.type === 'folder') {
          await api.renameFolder(oldPath, newName);
          const data = await api.listFolders({ all: true });
          setFolders(data);
          return;
        }

        // For documents, just rename in place
        await api.renameDoc(oldPath, newName);
          if (selectedDoc?.rel_path === oldPath) {
          const finalPath = oldDir ? `${oldDir}/${newName}` : newName;
            setSelectedDoc((prev) => (prev ? { ...prev, rel_path: finalPath } : prev));
        }

        const data = await api.listFolders({ all: true });
        setFolders(data);
        if (oldDir) await refreshFolder(oldDir);
        return;
      }

      if (kind === 'RENAME_IDEA_BOX') {
        const newName = String(value || '').trim();
        if (!newName) return;
        if (newName.includes('/') || newName.includes('\\')) {
          throw new Error(t('dialog.rename.invalidName') || 'Name cannot contain path separators');
        }
        const oldName = payload.box;
        const boxName = await ideaLoader.renameBox(oldName, newName);
        navigate(buildIdeaRoute(boxName, ideaLoader.selectedDate));
        return;
      }

      if (kind === 'SET_DESCRIPTION') {
        const v = String(value || '');
        const docRelPath = payload.docRelPath;
        if (!docRelPath) return;
        await api.setDocDescription(docRelPath, v);
        const parent = dirname(docRelPath);
        if (parent) await refreshFolder(parent);
        if (selectedDoc?.rel_path === docRelPath) {
          setSelectedDoc((prev) => (prev ? { ...prev, description: v } : prev));
        }
        return;
      }

      if (kind === 'DELETE_ITEM') {
        await performDelete(payload.item);
      }

      if (kind === 'DELETE_IDEA_BOX') {
        const box = payload.box;
        await ideaLoader.deleteBox(box);
        navigate(buildIdeaRoute(ideaLoader.selectedBox, ideaLoader.selectedDate));
        return;
      }

      if (kind === 'MOVE_IDEA_THREAD') {
        const targetBox = String(value || '').trim();
        if (!targetBox) return;
        await ideaLoader.moveThread(payload.threadId, targetBox);
        return;
      }
    } catch (err) {
      setDialog({ isOpen: true, type: 'alert', title: t('error.operationFailed'), message: err.message, kind: 'ALERT' });
    }
  };

  const handleRequestMoveFromDnd = ({ payload, targetFolderPath }) => {
    const target = String(targetFolderPath || '').trim();
    if (!target) {
      setDialog({
        isOpen: true,
        type: 'alert',
        title: t('error.invalidOperation'),
        message: t('error.rootNotSupported'),
        kind: 'ALERT',
      });
      return;
    }

    if (payload?.type === 'doc') {
      const docRelPath = payload.rel_path;
      if (!docRelPath) return;
      const parentPath = dirname(docRelPath);
      if (parentPath === target) return;
      setDialog({
        isOpen: true,
        type: 'confirm',
        title: t('dialog.move.pageTitle'),
        message: t('dialog.move.confirmMessage', { name: String(docRelPath).split('/').pop(), target }),
        confirmText: t('common.move'),
        kind: 'CONFIRM_MOVE_DOC',
        payload: { docRelPath, targetFolderPath: target },
      });
      return;
    }

    if (payload?.type === 'folder') {
      const sourcePath = payload.path;
      if (!sourcePath) return;
      const sourceParent = dirname(sourcePath);
      if (sourceParent === target) return;
      if (isDescendantPath(sourcePath, target)) {
        setDialog({
          isOpen: true,
          type: 'alert',
          title: t('error.invalidOperation'),
          message: t('error.cannotMoveIntoSelf'),
          kind: 'ALERT',
        });
        return;
      }
      setDialog({
        isOpen: true,
        type: 'confirm',
        title: t('dialog.move.folderTitle'),
        message: t('dialog.move.confirmMessage', { name: payload.name || String(sourcePath).split('/').pop(), target }),
        confirmText: t('common.move'),
        kind: 'CONFIRM_MOVE_FOLDER',
        payload: { sourcePath, targetFolderPath: target },
      });
    }
  };

  // Editor Save Logic (Keep existing)
  const handleContentChange = (value) => {
    // 防止相同内容重复触发，避免无限循环
    if (value === docContent) return;

    setDocContent(value);
    if (isHydratingContentRef.current) return;
    if (value === lastSavedContentRef.current) {
      dispatchSave({ type: 'CONTENT_SYNCED' });
      return;
    }
    dispatchSave({ type: 'CONTENT_CHANGED' });
  };
  async function saveDocument(trigger = 'auto') {
    if (!selectedDoc) return true;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (docContent === lastSavedContentRef.current) {
      dispatchSave({ type: 'CONTENT_SYNCED' });
      return true;
    }
    dispatchSave({ type: 'SAVE_START' });
    try {
      await api.saveDocContent(selectedDoc.rel_path, docContent, selectedDoc.description);
      lastSavedContentRef.current = docContent;
      dispatchSave({ type: 'SAVE_SUCCESS', message: `Saved at ${new Date().toLocaleTimeString()}` });
      return true;
    } catch (err) {
      dispatchSave({ type: 'SAVE_ERROR', errorMessage: err.message });
      return false;
    }
  }
  saveDocumentRef.current = saveDocument;
  useEffect(() => { if (!selectedDoc || !save.hasPendingChanges || isHydratingContentRef.current) return; if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = setTimeout(() => saveDocument('auto'), AUTO_SAVE_DELAY); return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); }; }, [selectedDoc, docContent, save.hasPendingChanges]);

  return (
    <div className={`flex h-screen bg-white text-gray-900 font-sans ${isResizingSidebar ? 'cursor-col-resize select-none' : ''}`} onClick={() => setContextMenu(null)}>
      {foldersLoaded ? (
        <SidebarTree
          folders={folders}
          folderDocs={folderDocs}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          refreshFolder={refreshFolder}
          refreshSidebarAll={refreshSidebarAll}
          loadDoc={(doc, options) => {
            navigate(ROUTES.HOME); // Switch back to editor view when loading a doc
            loadDoc(doc, options);
          }}
          selectedDoc={selectedDoc}
          onContextMenu={handleContextMenu}
          onRequestCreateFolder={handleCreateFolderAction}
          onRequestCreatePage={handleCreatePageAction}
          onRequestMoveFromDnd={handleRequestMoveFromDnd}
          onRequestSearch={() => setIsSearchOpen(true)}
          onRequestSettings={() => navigate(ROUTES.SETTINGS)}
          onRequestIdea={() => navigate(buildIdeaRoute(ideaLoader.selectedBox))}
          onRequestCreateIdeaBox={handleCreateIdeaBoxAction}
          onRequestRenameIdeaBox={handleRenameIdeaBoxAction}
          onRequestDeleteIdeaBox={handleDeleteIdeaBoxAction}
          ideaLoader={ideaLoader}
          onCopyFolderCitation={handleCopyFolderCitation}
          onCopyDocCitation={handleCopyDocCitation}
          onMoveFolder={handleMoveFolderAction}
          onRenameFolder={handleRenameAction}
          onDeleteFolder={handleDeleteAction}
          onMoveDoc={handleMoveDocAction}
          onEditDocDescription={handleEditDescriptionAction}
          onRenameDoc={handleRenameAction}
          onDeleteDoc={handleDeleteAction}
          activeView={view}
          sidebarWidth={sidebarWidth}
          startResizing={startResizing}
        />
      ) : (
        <aside style={{ width: sidebarWidth }} className="flex-shrink-0 bg-[#F7F7F5] border-r border-[#E9E9E7] dark:bg-zinc-900 dark:border-zinc-800 flex flex-col">
          <SidebarSkeleton />
        </aside>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 bg-white relative">
        {/* Top Drag Region */}
        <DragRegion className="absolute top-0 left-0 right-0 h-4 z-50" />
        
        {view === 'settings' ? (
          <div className="flex-1 overflow-auto">
            <Settings />
          </div>
        ) : view === 'idea' ? (
          <IdeaTimeline
            selectedDate={ideaLoader.selectedDate}
            selectedBox={ideaLoader.selectedBox}
            allEntriesGrouped={ideaLoader.allEntriesGrouped}
            isLoading={ideaLoader.isLoading}
            onAddEntry={ideaLoader.addEntry}
            onContinueThread={ideaLoader.continueThread}
            onAddAIReflection={ideaLoader.addAIReflection}
            onDeleteEntry={ideaLoader.deleteEntry}
            onRequestMoveThread={handleMoveIdeaThreadAction}
            onOpenDocById={openDocFromRef}
            onOpenIdeaRef={openIdeaRef}
            focusEntryId={ideaFocusEntryId}
            onClearFocusEntry={() => setIdeaFocusEntryId(null)}
            onRefresh={ideaLoader.refresh}
          />
        ) : (
          <>
        <header 
          className="h-12 flex items-center justify-between px-4 notion-header transition-all select-none relative z-10"
        >
          <div 
            className="flex items-center gap-2 overflow-hidden flex-1 mr-4"
            {...dragProps}
          >
            {/* Breadcrumbs - stop propagation to allow clicking */}
            <div onMouseDown={(e) => e.stopPropagation()}>
              <Breadcrumbs selectedDoc={selectedDoc} saveState={save.saveState} />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            {selectedDoc && toc.length > 0 && (
              <Toc
                toc={toc}
                isOpen={isTocOpen}
                activeId={activeTocId}
                onToggle={() => setIsTocOpen(!isTocOpen)}
                onSelectHeading={scrollToTocHeading}
                showPanel={false}
              />
            )}
            <div className="text-xs text-gray-400 w-20 text-right">{save.errorMessage || t(save.saveMessageKey)}</div>
          </div>
        </header>
        <div className="flex-1 overflow-hidden relative flex">
          {error && <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-50 text-red-600 px-4 py-2 rounded-md shadow-sm border border-red-100 z-50 text-sm">{error}</div>}
          {isLoadingContent || !foldersLoaded ? <PageSkeleton /> : selectedDoc ? (
            <div ref={editorScrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
               <div className="max-w-[900px] mx-auto pb-32">
                 <div className="pt-8 px-12 group">
                    {spaceNewDocs && spaceNewDocs.space === currentSpace && (
                      <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 flex items-center gap-3">
                        <div className="text-sm text-sky-800">
                          {t('notification.newPages', { space: spaceNewDocs.space, count: spaceNewDocs.count })}
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2.5 py-1.5 text-sm font-medium rounded bg-sky-600 text-white hover:bg-sky-700"
                            onClick={async () => {
                              await refreshSidebarForSpace(spaceNewDocs.space);
                              setSpaceNewDocs(null);
                            }}
                          >
                            {t('notification.refresh')}
                          </button>
                          <button
                            type="button"
                            className="px-2.5 py-1.5 text-sm font-medium rounded text-sky-800 hover:bg-sky-100"
                            onClick={() => setSpaceNewDocs(null)}
                          >
                            {t('notification.dismiss')}
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedDoc && (
                      <div className="mb-6">
                        {selectedDoc.description ? (
                          <div
                            className="group/desc relative"
                            onContextMenu={(e) => {
                              // Allow quick edit via right click on description
                              e.preventDefault();
                              handleEditDescriptionAction(selectedDoc);
                            }}
                          >
                            <TiptapMarkdownViewer
                              markdown={selectedDoc.description}
                              editorId={`desc-${selectedDoc.rel_path}`}
                              className="prose prose-zinc max-w-none text-lg text-gray-600 leading-relaxed font-light"
                              onOpenDocById={openDocByStableId}
                              onOpenIdeaRef={openIdeaRef}
                            />
                            <button
                              type="button"
                              className="absolute -right-2 -top-2 opacity-0 group-hover/desc:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 text-gray-500"
                              title={t('common.editDescription')}
                              onClick={() => handleEditDescriptionAction(selectedDoc)}
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-left text-lg text-gray-400 mb-6 leading-relaxed font-light hover:text-gray-600"
                            onClick={() => handleEditDescriptionAction(selectedDoc)}
                          >
                            {t('common.addDescription')}
                          </button>
                        )}
                      </div>
                    )}
                    {/* Hidden Metadata (Cleaner UI) */}
                    {/* <div className="flex items-center gap-4 text-xs text-gray-400 mb-8 border-b border-gray-100 pb-4"><span>{new Date(selectedDoc.updated_at).toLocaleDateString()}</span><span>{docContent.length} chars</span></div> */}
              </div>
                 <TiptapMarkdownEditor
                   ref={editorRef}
                   markdown={docContent}
                   docMeta={selectedDoc}
                   editorId={`editor-${selectedDoc.rel_path}`}
                   onChange={handleContentChange}
                   onOpenDocById={openDocByStableId}
                   onOpenIdeaRef={openIdeaRef}
                   onTocUpdate={handleTocUpdate}
                   className={EDITOR_CONTENT_CLASSES}
                   placeholder={t('editor.placeholder')}
                   readOnly={Boolean(diffGate)}
                 />
                </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 select-none">
              <div className="w-16 h-16 mb-6 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center shadow-sm">
                <DocumentPlusIcon className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
              </div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">{t('emptyState.title')}</h3>
              <p className="text-xs text-gray-400 mb-6">{t('emptyState.subtitle')}</p>
              <button
                type="button"
                onClick={() => handleCreatePageAction('')}
                className="px-4 py-2 bg-black text-white text-xs font-medium rounded hover:bg-gray-800 transition-colors shadow-sm"
              >
                {t('emptyState.createButton')}
              </button>
            </div>
          )}
          {selectedDoc && toc.length > 0 && (
            <Toc
              toc={toc}
              isOpen={isTocOpen}
              activeId={activeTocId}
              onToggle={() => setIsTocOpen(!isTocOpen)}
              onSelectHeading={scrollToTocHeading}
              showToggle={false}
              showPanel
            />
          )}
          </div>
          </>
        )}
      </main>

      <CustomDialog 
        isOpen={!!dialog?.isOpen} 
        type={dialog?.type}
        title={dialog?.title}
        message={dialog?.message}
        placeholder={dialog?.placeholder}
        initialValue={dialog?.initialValue}
        onConfirm={handleDialogConfirm}
        confirmText={dialog?.confirmText}
        cancelText={dialog?.cancelText}
        isDestructive={dialog?.isDestructive}
        onClose={() => setDialog(null)}
      />

      {diffGate && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => {}} />
          <div className="relative w-full max-w-[980px] bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="font-semibold text-gray-900">检测到远端更新（编辑前对齐）</div>
              <div className="text-xs text-gray-400 ml-auto font-mono">{diffGate.rel_path}</div>
            </div>
            <div className="px-6 py-4">
              <div className="text-sm text-gray-600 mb-3">
                你本地有未保存修改，同时远端内容已更新。请选择如何处理：
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1">本地（未保存）</div>
                  <pre className="text-xs leading-5 font-mono whitespace-pre-wrap break-words rounded border border-red-200 bg-red-50 p-3 max-h-[360px] overflow-auto">
{diffGate.snippet?.local || diffGate.local}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1">远端（最新）</div>
                  <pre className="text-xs leading-5 font-mono whitespace-pre-wrap break-words rounded border border-green-200 bg-green-50 p-3 max-h-[360px] overflow-auto">
{diffGate.snippet?.remote || diffGate.remote}
                  </pre>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700"
                  onClick={async () => {
                    try {
                      await loadDoc({ ...selectedDoc, updated_at: diffGate.remoteUpdatedAt });
                    } finally {
                      setDiffGate(null);
                    }
                  }}
                >
                  用远端覆盖（丢弃本地）
                </button>
                <button
                  type="button"
                  className="px-3 py-2 text-sm font-medium rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                  onClick={() => {
                    setDiffGate(null);
                  }}
                >
                  保留本地继续编辑
                </button>
                <button
                  type="button"
                  className="ml-auto px-3 py-2 text-sm font-medium rounded text-gray-700 hover:bg-gray-100"
                  onClick={async () => {
                    try {
                      await writeClipboardText(diffGate.remote);
                      setDialog({ isOpen: true, type: 'alert', title: t('diffGate.copied'), message: t('diffGate.copiedRemote') });
                    } catch (e) {
                      setDialog({ isOpen: true, type: 'alert', title: t('diffGate.copyFailed'), message: e.message });
                    }
                  }}
                >
                  {t('diffGate.copyRemote')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <ContextMenu 
        isOpen={!!contextMenu} 
        x={contextMenu?.x || 0} 
        y={contextMenu?.y || 0} 
        onClose={() => setContextMenu(null)}
        items={contextMenu ? (
          contextMenu.target.type === 'folder' ? [
            { label: t('contextMenu.copyCitation'), icon: ClipboardDocumentIcon, onClick: () => handleCopyFolderCitation(contextMenu.target) },
            { label: t('contextMenu.move'), icon: FolderIcon, onClick: () => handleMoveFolderAction(contextMenu.target) },
            { label: t('contextMenu.newPage'), icon: DocumentPlusIcon, onClick: () => handleCreatePageAction(contextMenu.target.path) },
            { label: t('contextMenu.newFolder'), icon: FolderPlusIcon, onClick: () => handleCreateFolderAction(contextMenu.target.path) },
            { label: t('contextMenu.rename'), icon: PencilIcon, onClick: () => handleRenameAction(contextMenu.target) },
            { label: t('contextMenu.delete'), icon: TrashIcon, className: 'text-red-600', onClick: () => handleDeleteAction(contextMenu.target) }
          ] : [
            { label: t('contextMenu.copyCitation'), icon: ClipboardDocumentIcon, onClick: () => handleCopyDocCitation(contextMenu.target) },
            { label: t('contextMenu.move'), icon: FolderIcon, onClick: () => handleMoveDocAction(contextMenu.target) },
            { label: t('contextMenu.editDescription'), icon: PencilIcon, onClick: () => handleEditDescriptionAction(contextMenu.target) },
            { label: t('contextMenu.rename'), icon: PencilIcon, onClick: () => handleRenameAction(contextMenu.target) },
            { label: t('contextMenu.delete'), icon: TrashIcon, className: 'text-red-600', onClick: () => handleDeleteAction(contextMenu.target) }
          ]
        ) : []} 
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectDoc={(doc) => {
          navigate(ROUTES.HOME); // Switch back to editor view
          loadDoc(doc, { urlMode: 'push' });
        }}
        onSelectIdea={(idea) => {
          openIdeaRef({ threadId: idea.threadId, date: idea.date, entryId: idea.entryId });
          setIsSearchOpen(false);
        }}
      />
    </div>
  );
}
