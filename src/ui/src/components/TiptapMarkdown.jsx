/**
 * TiptapMarkdown - Tiptap-based markdown editor component.
 *
 * Features:
 * - Full markdown support (GFM)
 * - Code block with syntax highlighting
 * - Tables
 * - Task lists
 * - Slash commands menu
 * - Floating toolbar for text formatting
 * - Page reference picker (oc://doc/ links)
 */

import { useEffect, useRef, useState, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import { Extension, InputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlock from '@tiptap/extension-code-block';
import Typography from '@tiptap/extension-typography';
import TableOfContents from '@tiptap/extension-table-of-contents';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import * as api from '../api';

// Custom extension to handle exiting lists on Enter in empty list items
const ListExitExtension = Extension.create({
  name: 'listExit',
  
  addKeyboardShortcuts() {
    return {
      // On Enter in an empty list item, exit the list
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        
        if (!empty) return false;
        
        // Check if we're in a list item
        const listItem = $from.node(-1);
        const listItemType = listItem?.type?.name;
        
        if (listItemType !== 'listItem' && listItemType !== 'taskItem') {
          return false;
        }
        
        // Check if the list item content is empty (only contains an empty paragraph or is truly empty)
        const listItemContent = listItem.textContent;
        if (listItemContent.length > 0) {
          return false; // Not empty, let default behavior handle
        }
        
        // Empty list item - exit the list
        // Try to lift the list item out of the list
        if (editor.can().liftListItem('listItem')) {
          return editor.commands.liftListItem('listItem');
        }
        if (editor.can().liftListItem('taskItem')) {
          return editor.commands.liftListItem('taskItem');
        }
        
        return false;
      },
      
      // On Backspace at the start of an empty list item, exit the list
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        
        if (!empty) return false;
        
        // Check if cursor is at the very start of a text block
        if ($from.parentOffset !== 0) return false;
        
        // Check if we're in a list item
        const listItem = $from.node(-1);
        const listItemType = listItem?.type?.name;
        
        if (listItemType !== 'listItem' && listItemType !== 'taskItem') {
          return false;
        }
        
        // Try to lift the list item out of the list
        if (editor.can().liftListItem('listItem')) {
          return editor.commands.liftListItem('listItem');
        }
        if (editor.can().liftListItem('taskItem')) {
          return editor.commands.liftListItem('taskItem');
        }
        
        return false;
      },
    };
  },
});

// Handle Tab indentation inside code blocks
const CodeBlockTabExtension = Extension.create({
  name: 'codeBlockTab',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive('codeBlock')) return false;
        editor.commands.insertContent('  ');
        return true;
      },
      'Shift-Tab': ({ editor }) => {
        if (!editor.isActive('codeBlock')) return false;
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return true;
        const pos = selection.from;
        if (pos < 2) return true;
        const textBefore = state.doc.textBetween(pos - 2, pos, '\0', '\0');
        if (textBefore === '  ') {
          editor.commands.deleteRange({ from: pos - 2, to: pos });
        }
        return true;
      },
    };
  },
});

// Helpers for mixed nested lists (bullet under ordered, or ordered under bullet)
const NestedListHelpers = Extension.create({
  name: 'nestedListHelpers',
  addCommands() {
    return {
      insertNestedBulletList:
        () =>
        ({ editor, tr, state, dispatch }) => {
          const listItemType = state.schema.nodes.listItem;
          const bulletListType = state.schema.nodes.bulletList;
          const paragraphType = state.schema.nodes.paragraph;
          if (!listItemType || !bulletListType || !paragraphType) return false;

          // Build a minimal nested bullet list node
          const nested = bulletListType.createAndFill(
            {},
            listItemType.createAndFill({}, paragraphType.createAndFill()),
          );
          if (!nested) return false;

          // If not inside listItem, just toggle bullet list
          if (!editor.isActive('listItem')) {
            return editor.chain().focus().toggleBulletList().run();
          }

          // Insert nested list inside current list item
          return editor
            .chain()
            .focus()
            .insertContent(nested.toJSON())
            .run();
        },
      insertNestedOrderedList:
        () =>
        ({ editor, tr, state, dispatch }) => {
          const listItemType = state.schema.nodes.listItem;
          const orderedListType = state.schema.nodes.orderedList;
          const paragraphType = state.schema.nodes.paragraph;
          if (!listItemType || !orderedListType || !paragraphType) return false;

          const nested = orderedListType.createAndFill(
            {},
            listItemType.createAndFill({}, paragraphType.createAndFill()),
          );
          if (!nested) return false;

          if (!editor.isActive('listItem')) {
            return editor.chain().focus().toggleOrderedList().run();
          }

          return editor
            .chain()
            .focus()
            .insertContent(nested.toJSON())
            .run();
        },
    };
  },
});

// Mixed list type switcher - only switches the CURRENT nested list level
// When user types "- " at start of an ordered list item, convert THAT list to bullet
// When user types "1. " at start of a bullet list item, convert THAT list to ordered
// When user types "[ ] " or "[] " at start of any list item, convert to task list
// When user types "- " at start of a task list item, convert to bullet list
const MixedListSwitch = Extension.create({
  name: 'mixedListSwitch',
  
  addKeyboardShortcuts() {
    return {
      // Handle space after "- ", "1. ", "[ ]", "[]" patterns
      Space: ({ editor }) => {
        const { state, view } = editor;
        const { selection, schema, tr } = state;
        const { $from } = selection;
        
        // Get text before cursor in current paragraph
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, '\ufffc');
        
        // Helper to find the immediate parent list of the current listItem
        const findParentList = () => {
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList') {
              return { node, pos: $from.before(d), depth: d };
            }
          }
          return null;
        };
        
        // Check for "[ ]" or "[]" pattern -> convert to task list
        if (textBefore === '[ ]' || textBefore === '[]') {
          const parentList = findParentList();
          if (parentList && (parentList.node.type.name === 'bulletList' || parentList.node.type.name === 'orderedList')) {
            // Delete the pattern first, then toggle to task list
            const deleteFrom = $from.pos - textBefore.length;
            const deleteTo = $from.pos;
            
            editor.chain()
              .focus()
              .deleteRange({ from: deleteFrom, to: deleteTo })
              .toggleTaskList()
              .run();
            return true;
          }
        }
        
        // Check for "-" pattern (user typed "-" and now pressing space)
        if (textBefore === '-') {
          const parentList = findParentList();
          if (parentList) {
            // If in task list, convert to bullet list
            if (parentList.node.type.name === 'taskList') {
              const deleteFrom = $from.pos - 1;
              const deleteTo = $from.pos;
              
              editor.chain()
                .focus()
                .deleteRange({ from: deleteFrom, to: deleteTo })
                .toggleTaskList()
                .toggleBulletList()
                .run();
              return true;
            }
            
            // If in ordered list, convert to bullet list
            if (parentList.node.type.name === 'orderedList') {
              const bulletListType = schema.nodes.bulletList;
              if (!bulletListType) return false;
              
              const deleteFrom = $from.pos - 1;
              const deleteTo = $from.pos;
              
              const newTr = tr.delete(deleteFrom, deleteTo);
              const mappedPos = newTr.mapping.map(parentList.pos);
              newTr.setNodeMarkup(mappedPos, bulletListType, parentList.node.attrs);
              
              view.dispatch(newTr);
              return true;
            }
          }
        }
        
        // Check for "1." or any number pattern (user typed "1." and now pressing space)
        if (/^\d+\.$/.test(textBefore)) {
          const parentList = findParentList();
          if (parentList) {
            // If in task list, convert to ordered list
            if (parentList.node.type.name === 'taskList') {
              const deleteFrom = $from.pos - textBefore.length;
              const deleteTo = $from.pos;
              
              editor.chain()
                .focus()
                .deleteRange({ from: deleteFrom, to: deleteTo })
                .toggleTaskList()
                .toggleOrderedList()
                .run();
              return true;
            }
            
            // If in bullet list, convert to ordered list
            if (parentList.node.type.name === 'bulletList') {
              const orderedListType = schema.nodes.orderedList;
              if (!orderedListType) return false;
              
              const deleteFrom = $from.pos - textBefore.length;
              const deleteTo = $from.pos;
              
              const newTr = tr.delete(deleteFrom, deleteTo);
              const mappedPos = newTr.mapping.map(parentList.pos);
              newTr.setNodeMarkup(mappedPos, orderedListType, parentList.node.attrs);
              
              view.dispatch(newTr);
              return true;
            }
          }
        }
        
        return false; // Let default space behavior happen
      },
    };
  },
});

// --- Editor sub-components ---
import TiptapSlashMenu from '../editor/tiptap/SlashMenu';
import TiptapFloatingToolbar from '../editor/tiptap/FloatingToolbar';
import TiptapTableToolbar from '../editor/tiptap/TableToolbar';
import PageRefPicker from '../editor/tiptap/PageRefPicker';
import TiptapCodeBlockComponent from '../editor/tiptap/CodeBlockComponent';
import HighlightJsExtension from '../editor/tiptap/HighlightJsExtension';
import { buildIdeaRefUrl, parseIdeaRefUrl } from '../utils/ideaRef';
import IdeaRefBlock from '../editor/tiptap/IdeaRefBlock';

// Use CodeBlock with custom NodeView for highlight.js rendering
const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TiptapCodeBlockComponent);
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive('codeBlock')) return false;
        return this.editor.commands.command(({ tr, state }) => {
          const { selection } = state;
          tr.insertText('  ', selection.from, selection.to);
          return true;
        });
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('codeBlock')) return false;
        return this.editor.commands.command(({ tr, state }) => {
          const { selection } = state;
          const { $from } = selection;
          // Get the text before cursor in current line
          const parent = $from.parent;
          const offset = $from.parentOffset;
          const textBefore = parent.textBetween(0, offset, '\n', '\n');
          const lastNewline = textBefore.lastIndexOf('\n');
          const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
          const maybeSpaces = parent.textBetween(lineStart, lineStart + 2, '\n', '\n');
          if (maybeSpaces === '  ') {
            const from = $from.start() + lineStart;
            tr.delete(from, from + 2);
            return true;
          }
          return true; // Handled but nothing to delete
        });
      },
    };
  },
}).configure({
  HTMLAttributes: {
    class: 'tiptap-code-block',
  },
});

const StableTableOfContents = TableOfContents.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      pendingUpdate: false,
      compositionHandler: null,
    };
  },
  onCreate() {
    this.parent?.();
    if (!this.editor?.view?.dom) return;

    const handleCompositionEnd = () => {
      if (!this.storage.pendingUpdate) return;
      this.storage.pendingUpdate = false;
      this.editor.commands.updateTableOfContents();
    };

    this.storage.compositionHandler = handleCompositionEnd;
    this.editor.view.dom.addEventListener('compositionend', handleCompositionEnd);
  },
  onDestroy() {
    if (this.storage?.compositionHandler && this.editor?.view?.dom) {
      this.editor.view.dom.removeEventListener('compositionend', this.storage.compositionHandler);
    }
    this.parent?.();
  },
  onTransaction({ transaction }) {
    if (!transaction.docChanged || transaction.getMeta('toc')) return;
    if (transaction.getMeta('composition') || this.editor?.view?.composing) {
      this.storage.pendingUpdate = true;
      return;
    }
    this.editor.commands.updateTableOfContents();
  },
});

// Custom Link extension that handles oc:// protocol
const CustomLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      protocols: ['http', 'https', 'mailto', 'tel', 'oc'],
      openOnClick: true,
      HTMLAttributes: {
        class: 'oc-link',
      },
    };
  },
});


/**
 * Main Tiptap Markdown Editor Component
 */
export const TiptapMarkdownEditor = forwardRef(function TiptapMarkdownEditor({
  markdown,
  docMeta,
  editorId,
  onChange,
  onOpenDocById,
  onOpenIdeaRef,
  onTocUpdate,
  readOnly = false,
  onEditIntent,
  className,
  placeholder,
}, ref) {
  const { t } = useTranslation();
  const lastMarkdownRef = useRef({ id: editorId, value: markdown });
  const [toast, setToast] = useState(null);
  const [isPageRefOpen, setIsPageRefOpen] = useState(false);
  const docMetaCacheRef = useRef(new Map());
  
  // Debounced onChange
  const serializeTimerRef = useRef(null);
  const pendingSerializeRef = useRef(false);
  // Track if user is actively editing to prevent external sync
  const isEditingRef = useRef(false);
  const editingTimeoutRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Use CodeBlock instead
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: false, // prevent duplicate link extension (we add CustomLink)
      }),
      MixedListSwitch, // allow typing "- " / "1. " to switch list type in-place
      NestedListHelpers, // allow mixed nested lists (bullet under ordered, etc.)
      ListExitExtension, // Handle exiting lists on Enter/Backspace in empty items
      CodeBlockTabExtension, // Allow Tab indentation in code blocks
      CustomCodeBlock,
      HighlightJsExtension,
      IdeaRefBlock,
      CustomLink,
      Placeholder.configure({
        placeholder: placeholder || t('editor.placeholder') || 'Type / for commands...',
        emptyEditorClass: 'is-editor-empty',
      }),
      Table.configure({
        resizable: false,
        HTMLAttributes: { class: 'tiptap-table' },
      }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList.configure({
        HTMLAttributes: { class: 'task-list' },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: 'task-item' },
      }),
      Typography,
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'tiptap-image',
        },
      }),
      StableTableOfContents.configure({
        onUpdate: (anchors = []) => {
          // anchors: [{ id, level, textContent, originalLevel, isActive, pos, node, ... }]
          const mapped = anchors.map((a, idx) => {
            const id = a.id || `heading-${idx}`;
            return {
              id,
              level: a.level || a.originalLevel || 1,
              text: a.textContent || '',
              pos: a.pos, // position in the document
              isActive: a.isActive,
            };
          });
          onTocUpdate?.(mapped);
        },
      }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: '-',
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: markdown,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: `tiptap-editor prose prose-sm max-w-none focus:outline-none ${className || ''}`,
      },
      handleClick: (view, pos, event) => {
        // Handle idea reference block clicks
        const target = event.target;
        if (target instanceof HTMLElement) {
          const ideaRef = target.closest?.('.idea-ref');
          const href = ideaRef?.getAttribute('data-idea-href') || '';
          if (href.startsWith('oc://idea/')) {
            event.preventDefault();
            event.stopPropagation();
            const parsed = parseIdeaRefUrl(href);
            if (parsed) onOpenIdeaRef?.(parsed);
            return true;
          }
        }
        // Handle oc://doc/ link clicks
        if (target instanceof HTMLAnchorElement) {
          const href = target.getAttribute('href') || '';
          if (href.startsWith('oc://doc/')) {
            event.preventDefault();
            event.stopPropagation();
            
            let stableId = '';
            let fallbackRelPath = '';
            try {
              const u = new URL(href);
              stableId = String(u.pathname || '').replace(/^\/+/, '').trim();
              fallbackRelPath = decodeURIComponent(u.searchParams.get('path') || '').trim();
            } catch {
              stableId = href.slice('oc://doc/'.length).trim();
            }
            
            if (stableId || fallbackRelPath) {
              onOpenDocById?.(stableId, { fallbackRelPath });
            }
            return true;
          }

          if (href.startsWith('oc://idea/')) {
            event.preventDefault();
            event.stopPropagation();
            const parsed = parseIdeaRefUrl(href);
            if (parsed) onOpenIdeaRef?.(parsed);
            return true;
          }
          
          // External links: Cmd/Ctrl+Click to open
          if (!readOnly && (event.metaKey || event.ctrlKey)) {
            window.open(href, '_blank', 'noopener,noreferrer');
            return true;
          }
        }
        
        if (!readOnly) onEditIntent?.();
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (!onChange) return;
      
      // Mark as actively editing to prevent external sync
      isEditingRef.current = true;
      if (editingTimeoutRef.current) clearTimeout(editingTimeoutRef.current);
      editingTimeoutRef.current = setTimeout(() => {
        isEditingRef.current = false;
      }, 500); // Consider editing done after 500ms of inactivity
      
      // Debounce serialization
      if (serializeTimerRef.current) clearTimeout(serializeTimerRef.current);
      pendingSerializeRef.current = true;
      
      serializeTimerRef.current = setTimeout(() => {
        if (!pendingSerializeRef.current) return;
        pendingSerializeRef.current = false;
        
        try {
          const md = editor.storage.markdown.getMarkdown();
          // Skip if markdown is too large (likely contains large base64 image)
          // This prevents performance issues and potential crashes
          if (md && md.length > 500000) {
            console.warn('Markdown content is very large, skipping auto-save');
            return;
          }
          if (lastMarkdownRef.current.value !== md || lastMarkdownRef.current.id !== editorId) {
            lastMarkdownRef.current = { id: editorId, value: md };
            onChange(md);
          }
        } catch (e) {
          console.warn('Markdown serialize failed:', e);
        }
      }, 150);
    },
  }, [editorId, onTocUpdate]);

  // Expose scrollToPos method for TOC navigation
  useImperativeHandle(ref, () => ({
    scrollToPos: (pos) => {
      if (!editor || typeof pos !== 'number') return;
      try {
        // Get the DOM coordinates at the given position
        const coords = editor.view.coordsAtPos(pos);
        if (coords) {
          // Find the closest scrollable container
          let scrollContainer = editor.view.dom.parentElement;
          while (scrollContainer && scrollContainer !== document.body) {
            const style = getComputedStyle(scrollContainer);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
            scrollContainer = scrollContainer.parentElement;
          }
          
          if (scrollContainer && scrollContainer !== document.body) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const targetTop = coords.top - containerRect.top + scrollContainer.scrollTop - 80; // 80px offset from top
            scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' });
          } else {
            // Fallback: use Tiptap's scrollIntoView
            editor.chain().setTextSelection(pos).scrollIntoView().run();
          }
        }
      } catch (e) {
        console.warn('scrollToPos failed:', e);
      }
    },
    getEditor: () => editor,
  }), [editor]);

  // Sync content when markdown prop changes externally
  useEffect(() => {
    if (!editor) return;
    
    // Skip sync if user is actively editing (prevents cursor jump)
    if (isEditingRef.current) return;
    
    const last = lastMarkdownRef.current;
    // Only sync if editorId changed (switching docs) or if content is genuinely different
    if (last.id === editorId && last.value === markdown) return;
    
    // If only the id changed, always sync
    // If content changed but same doc, only sync if not from our own onChange
    if (last.id === editorId) {
      // Same doc - this might be our own onChange echoing back, skip
      return;
    }
    
    // Different doc - always sync
    editor.commands.setContent(markdown);
    lastMarkdownRef.current = { id: editorId, value: markdown };
  }, [editor, editorId, markdown]);

  // Cleanup pending serialization on unmount
  useEffect(() => {
    return () => {
      if (serializeTimerRef.current) {
        clearTimeout(serializeTimerRef.current);
        // Flush pending changes
        if (pendingSerializeRef.current && editor && onChange) {
          try {
            const md = editor.storage.markdown.getMarkdown();
            if (lastMarkdownRef.current.value !== md) {
              onChange(md);
            }
          } catch {
            // ignore
          }
        }
      }
    };
  }, [editor, onChange]);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((msg) => {
    if (msg) setToast(String(msg));
  }, []);

  // Insert page reference link
  const insertPageRef = useCallback(async (doc) => {
    if (!editor) return;
    
    const label = (doc.rel_path || '').split('/').pop()?.replace(/\.md$/i, '') || t('editor.page');
    const relPath = String(doc?.rel_path || '').trim();
    const fallbackPath = encodeURIComponent(relPath);
    
    let stableId = String(doc?.stable_id || doc?.stableId || '').trim();
    if (!stableId && relPath) {
      try {
        const meta = await api.getDocMeta(relPath);
        stableId = String(meta?.stable_id || meta?.stableId || '').trim();
      } catch {
        // ignore
      }
    }
    
    const url = stableId
      ? (fallbackPath ? `oc://doc/${stableId}?path=${fallbackPath}` : `oc://doc/${stableId}`)
      : (fallbackPath ? `oc://doc/?path=${fallbackPath}` : '');
    
    if (!url) {
      showToast(t('pageRef.missingId'));
      return;
    }
    
    // Insert link as its own paragraph to render as a card
    editor.chain().focus().insertContent({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: url, target: null, class: 'oc-link' } }],
          text: label,
        },
      ],
    }).run();
    
    setIsPageRefOpen(false);
    showToast(t('pageRef.inserted'));
  }, [editor, t, showToast]);

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

  const extractRefLinks = useCallback((text) => {
    if (!text) return [];
    const refs = [];
    const regex = /\[([^\]]+)\]\((oc:\/\/[^)]+)\)/g;
    let match = regex.exec(text);
    while (match) {
      refs.push({ label: match[1], href: match[2] });
      match = regex.exec(text);
    }
    return refs;
  }, []);

  const buildRefMeta = useCallback(async (text) => {
    const refs = extractRefLinks(text);
    if (!refs.length) return null;
    const refMeta = {};
    for (const ref of refs) {
      if (ref.href.startsWith('oc://doc/')) {
        const { stableId, fallbackRelPath } = parseDocHref(ref.href);
        const cacheKey = stableId || fallbackRelPath || ref.href;
        let meta = docMetaCacheRef.current.get(cacheKey);
        if (!meta) {
          try {
            meta = stableId
              ? await api.getDocById(stableId)
              : (fallbackRelPath ? await api.getDocMeta(fallbackRelPath) : null);
            if (meta) docMetaCacheRef.current.set(cacheKey, meta);
          } catch {
            meta = null;
          }
        }
        if (meta) {
          refMeta[ref.href] = {
            kind: 'doc',
            description: String(meta.description || '').trim(),
            path: String(meta.rel_path || '').trim(),
          };
        }
      } else if (ref.href.startsWith('oc://idea/')) {
        refMeta[ref.href] = { kind: 'idea' };
      }
    }
    return Object.keys(refMeta).length ? refMeta : null;
  }, [extractRefLinks, parseDocHref]);

  const insertIdeaRef = useCallback(async (thread) => {
    if (!editor || !thread) return;
    const entries = Array.isArray(thread.entries)
      ? await Promise.all(thread.entries.map(async (entry) => {
        const refMeta = await buildRefMeta(entry.content || '');
        return {
          id: entry.id,
          content: entry.content,
          createdAt: entry.createdAt,
          isAI: entry.isAI,
          images: entry.images || [],
          ...(refMeta ? { refMeta } : {}),
        };
      }))
      : [];
    const date = entries[0]?.createdAt ? new Date(entries[0].createdAt).toISOString().slice(0, 10) : '';
    editor.chain().focus().insertContent({
      type: 'ideaRefBlock',
      attrs: {
        threadId: thread.id,
        date,
        entries: JSON.stringify(entries),
      },
    }).run();
    setIsPageRefOpen(false);
    showToast(t('pageRef.inserted'));
  }, [editor, t, showToast, buildRefMeta]);

  if (!editor) return null;

  return (
    <div className="tiptap-markdown-editor relative">
      {/* Slash Menu */}
      {!readOnly && (
        <TiptapSlashMenu
          editor={editor}
          onOpenPageRef={() => setIsPageRefOpen(true)}
        />
      )}

      {/* Selection Floating Toolbar (using official BubbleMenu) */}
      {!readOnly && (
        <TiptapFloatingToolbar
          editor={editor}
          docMeta={docMeta}
          onToast={showToast}
        />
      )}

      {/* Table Toolbar (using official BubbleMenu - auto shows when in table) */}
      {!readOnly && <TiptapTableToolbar editor={editor} />}



      {/* Page Reference Picker Modal */}
      {isPageRefOpen && (
        <PageRefPicker
          docMeta={docMeta}
          onSelect={insertPageRef}
          onSelectIdea={insertIdeaRef}
          onClose={() => setIsPageRefOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10050] px-4 py-2 rounded-full bg-black/80 text-white text-sm font-medium shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}

      {/* Editor Content */}
      <EditorContent editor={editor} />
    </div>
  );
});

/**
 * Read-only Tiptap Markdown Viewer
 */
export function TiptapMarkdownViewer({
  markdown,
  editorId,
  className,
  onOpenDocById,
  onOpenIdeaRef,
}) {
  const contentRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false, // prevent duplicate link extension
      }),
      CustomCodeBlock,
      HighlightJsExtension,
      IdeaRefBlock,
      CustomLink,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: true,
        tightLists: true,
      }),
    ],
    content: markdown,
    editable: false,
    editorProps: {
      attributes: {
        class: `tiptap-viewer prose prose-sm max-w-none ${className || ''}`,
      },
      handleClick: (view, pos, event) => {
        const target = event.target;
        if (target instanceof HTMLElement) {
          const ideaRef = target.closest?.('.idea-ref');
          const href = ideaRef?.getAttribute('data-idea-href') || '';
          if (href.startsWith('oc://idea/')) {
            event.preventDefault();
            event.stopPropagation();
            const parsed = parseIdeaRefUrl(href);
            if (parsed && onOpenIdeaRef) onOpenIdeaRef(parsed);
            return true;
          }
        }
        if (target instanceof HTMLAnchorElement) {
          const href = target.getAttribute('href') || '';
          if (href.startsWith('oc://doc/')) {
            event.preventDefault();
            event.stopPropagation();
            
            let stableId = '';
            let fallbackRelPath = '';
            try {
              const u = new URL(href);
              stableId = String(u.pathname || '').replace(/^\/+/, '').trim();
              fallbackRelPath = decodeURIComponent(u.searchParams.get('path') || '').trim();
            } catch {
              stableId = href.slice('oc://doc/'.length).trim();
            }
            
            if ((stableId || fallbackRelPath) && onOpenDocById) {
              onOpenDocById(stableId, { fallbackRelPath });
            }
            return true;
          }

          if (href.startsWith('oc://idea/')) {
            event.preventDefault();
            event.stopPropagation();
            const parsed = parseIdeaRefUrl(href);
            if (parsed && onOpenIdeaRef) onOpenIdeaRef(parsed);
            return true;
          }
        }
        return false;
      },
    },
  }, [editorId, markdown]);

  // Add IDs to headings for scroll spy (content sync is handled by the useEffect above at line 523)
  useEffect(() => {
    if (!editor || !contentRef.current) return;
    
    // Use a small delay to ensure content is rendered
    const timer = setTimeout(() => {
      const headings = contentRef.current?.querySelectorAll('h1, h2, h3');
      headings?.forEach((node) => {
        const text = node.textContent || '';
        const slug = text.trim().toLowerCase().replace(/[^\w]+/g, '-');
        if (slug) node.id = slug;
        node.classList.add('scroll-mt-24');
      });
    }, 100);
    
    return () => clearTimeout(timer);
  }, [editor, editorId]); // Only run when switching docs, not on every content change

  if (!editor) return null;

  return (
    <div ref={contentRef}>
      <EditorContent editor={editor} />
    </div>
  );
}

export default TiptapMarkdownEditor;
