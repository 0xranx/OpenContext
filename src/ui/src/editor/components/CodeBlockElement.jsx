/**
 * CodeBlockElement - Custom code block UI with language dropdown and action buttons.
 *
 * Layout:
 * - Left: Language selection dropdown
 * - Right: Copy and Delete buttons
 */

import { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorRef } from 'platejs/react';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { LANG_OPTIONS } from '../constants';
import { CheckIcon, CopyIcon, ChevronDownIcon, TrashIcon } from './Icons';
import { cn } from '../utils/classNames';
import { getNodeTypes } from '../nodeTypes';
import { writeClipboardText } from '../../utils/clipboard';

const CodeBlockElement = memo((props) => {
  const { attributes, children, element } = props;
  const { t } = useTranslation();
  const editor = useEditorRef();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const lang = String(element?.lang || '').trim();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const currentLangLabel = useMemo(() => {
    const found = LANG_OPTIONS.find((o) => o.value === lang);
    return found?.label || lang || 'Plain Text';
  }, [lang]);

  const setLang = useCallback((next) => {
    try {
      const path = ReactEditor.findPath(editor, element);
      editor.tf.setNodes({ lang: next || undefined }, { at: path });
      setIsOpen(false);
    } catch {
      // ignore
    }
  }, [editor, element]);

  const [isCopied, setIsCopied] = useState(false);
  const copyToClipboard = useCallback(async () => {
    try {
      const text = Editor.string(editor, ReactEditor.findPath(editor, element));
      await writeClipboardText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }, [editor, element]);

  const deleteCodeBlock = useCallback(() => {
    try {
      const path = ReactEditor.findPath(editor, element);
      const types = getNodeTypes(editor);
      Transforms.removeNodes(editor, { at: path });
      Transforms.insertNodes(
        editor,
        { type: types.p, children: [{ text: '' }] },
        { at: path }
      );
      Transforms.select(editor, Editor.start(editor, path));
    } catch (err) {
      console.error('Failed to delete code block:', err);
    }
  }, [editor, element]);

  return (
    <div
      {...attributes}
      className="not-prose my-4 rounded-lg border border-gray-200 bg-gray-50"
    >
      <div
        contentEditable={false}
        className="relative px-3 py-2 border-b border-gray-200 bg-white/60 dark:bg-slate-900/60 flex items-center h-9 select-none rounded-t-lg"
        onMouseDown={(e) => {
          if (buttonRef.current?.contains(e.target) || dropdownRef.current?.contains(e.target)) {
            return;
          }
          e.preventDefault();
        }}
      >
        {/* Left: Language Dropdown */}
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors',
              isOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            )}
          >
            {currentLangLabel}
            <ChevronDownIcon className={cn('transition-transform duration-200', isOpen && 'rotate-180')} />
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <div
              ref={dropdownRef}
              className="absolute left-0 top-full mt-1 w-40 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl z-10 py-1 animate-in fade-in zoom-in-95 duration-100"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {LANG_OPTIONS.map((o) => (
                <button
                  key={o.value || 'plain'}
                  type="button"
                  onClick={() => setLang(o.value)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between',
                    (lang || '') === o.value
                      ? 'bg-blue-50 text-blue-600 font-medium'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <span>{o.label}</span>
                  {(lang || '') === o.value && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Copy + Delete Buttons */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title={t('codeBlock.copy')}
          >
            {isCopied ? (
              <>
                <CheckIcon className="text-green-600" />
                <span className="text-green-600">{t('codeBlock.copied')}</span>
              </>
            ) : (
              <>
                <CopyIcon />
                <span>{t('codeBlock.copy')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={deleteCodeBlock}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
            title={t('codeBlock.delete')}
          >
            <TrashIcon />
            <span>{t('codeBlock.delete')}</span>
          </button>
        </div>
      </div>

      <pre className="p-3 overflow-x-auto text-sm font-mono leading-6 text-gray-800 rounded-b-lg">
        <code data-lang={element?.lang || ''}>{children}</code>
      </pre>
    </div>
  );
});

export default CodeBlockElement;
