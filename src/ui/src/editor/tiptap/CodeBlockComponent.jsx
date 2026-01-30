/**
 * TiptapCodeBlockComponent - React NodeView for code blocks.
 *
 * Uses highlight.js decorations for syntax highlighting.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { ChevronDownIcon } from '../components/Icons';

const LANG_OPTIONS = [
  { value: '', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'tsx', label: 'TSX' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'diff', label: 'Diff' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'graphql', label: 'GraphQL' },
];

const LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'html',
  json: 'json',
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  docker: 'dockerfile',
};

const LANGUAGE_LABELS = LANG_OPTIONS.reduce((acc, opt) => {
  acc[opt.value] = opt.label;
  return acc;
}, {});

const normalizeLanguage = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  return LANGUAGE_ALIASES[key] || key;
};

/**
 * React NodeView for code blocks.
 */
function TiptapCodeBlockComponent({ node, updateAttributes, editor }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const rawLang = String(node.attrs.language || '').trim();
  const normalizedLang = normalizeLanguage(rawLang);
  const langLabel = LANGUAGE_LABELS[normalizedLang] || rawLang || 'Plain Text';
  const activeLang = LANGUAGE_LABELS[normalizedLang] ? normalizedLang : rawLang;

  useEffect(() => {
    if (!editor?.isEditable) return;
    if (!rawLang) return;
    if (normalizedLang && rawLang !== normalizedLang) {
      updateAttributes({ language: normalizedLang });
    }
  }, [editor?.isEditable, normalizedLang, rawLang, updateAttributes]);

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

  const setLanguage = useCallback((value) => {
    const next = normalizeLanguage(value);
    updateAttributes({ language: next || null });
    setIsOpen(false);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper className="tiptap-code-block not-prose">
      <div
        className="code-block-header"
        contentEditable={false}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
      >
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            className="code-block-lang-btn"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => setIsOpen((v) => !v)}
          >
            <span>{langLabel}</span>
            <ChevronDownIcon className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          {isOpen && (
            <div
              ref={dropdownRef}
              className="code-block-lang-menu"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.value || 'plain'}
                  type="button"
                  className={`code-block-lang-item ${activeLang === opt.value ? 'is-active' : ''}`}
                  onClick={() => setLanguage(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="code-block-content relative overflow-x-auto bg-gray-50 dark:bg-zinc-900">
        <pre className="code-pre">
          <NodeViewContent
            as="code"
            className="code-editor-layer hljs"
          />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

export default memo(TiptapCodeBlockComponent);
