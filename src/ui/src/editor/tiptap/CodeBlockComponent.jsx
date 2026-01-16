/**
 * TiptapCodeBlockComponent - React component for code block rendering.
 *
 * Note: This component is kept for reference but the actual code block
 * is rendered using a custom NodeView in TiptapMarkdown.jsx for better
 * performance with lowlight syntax highlighting.
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { CheckIcon, CopyIcon, ChevronDownIcon, TrashIcon } from '../components/Icons';
import { writeClipboardText } from '../../utils/clipboard';

const LANG_OPTIONS = [
  { value: '', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
];

/**
 * React NodeView for code blocks (alternative to vanilla JS NodeView)
 */
function TiptapCodeBlockComponent({ node, updateAttributes, editor, deleteNode }) {
  const { t } = useTranslation();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const lang = node.attrs.language || '';
  const currentLangLabel = LANG_OPTIONS.find((o) => o.value === lang)?.label || lang || 'Plain Text';

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const setLanguage = useCallback((value) => {
    updateAttributes({ language: value || null });
    setIsDropdownOpen(false);
  }, [updateAttributes]);

  const copyToClipboard = useCallback(async () => {
    try {
      const text = node.textContent;
      await writeClipboardText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }, [node]);

  const handleDelete = useCallback(() => {
    deleteNode();
  }, [deleteNode]);

  return (
    <NodeViewWrapper className="code-block-wrapper not-prose my-4 rounded-lg border border-gray-200 bg-gray-50">
      {/* Header */}
      <div
        contentEditable={false}
        className="relative px-3 py-2 border-b border-gray-200 bg-white/60 dark:bg-slate-900/60 flex items-center h-9 select-none rounded-t-lg"
      >
        {/* Language Dropdown */}
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
              isDropdownOpen
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {currentLangLabel}
            <ChevronDownIcon className={`transition-transform duration-200 ${isDropdownOpen && 'rotate-180'}`} />
          </button>

          {isDropdownOpen && (
            <div
              ref={dropdownRef}
              className="absolute left-0 top-full mt-1 w-40 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl z-10 py-1"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {LANG_OPTIONS.map((o) => (
                <button
                  key={o.value || 'plain'}
                  type="button"
                  onClick={() => setLanguage(o.value)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                    lang === o.value
                      ? 'bg-blue-50 text-blue-600 font-medium'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span>{o.label}</span>
                  {lang === o.value && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title={t('codeBlock.copy', 'Copy')}
          >
            {isCopied ? (
              <>
                <CheckIcon className="text-green-600" />
                <span className="text-green-600">{t('codeBlock.copied', 'Copied!')}</span>
              </>
            ) : (
              <>
                <CopyIcon />
                <span>{t('codeBlock.copy', 'Copy')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
            title={t('codeBlock.delete', 'Delete')}
          >
            <TrashIcon />
            <span>{t('codeBlock.delete', 'Delete')}</span>
          </button>
        </div>
      </div>

      {/* Code Content */}
      <pre className="p-3 overflow-x-auto text-sm font-mono leading-6 text-gray-800 rounded-b-lg">
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export default memo(TiptapCodeBlockComponent);
