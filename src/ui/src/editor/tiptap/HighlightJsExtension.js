import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import hljs from 'highlight.js/lib/common';

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

const normalizeLanguage = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  return LANGUAGE_ALIASES[key] || key;
};

const buildDecorations = (doc) => {
  const decorations = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const text = node.textContent || '';
    if (!text) return;

    const lang = normalizeLanguage(node.attrs.language);
    let html = '';
    try {
      if (lang && hljs.getLanguage(lang)) {
        html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } else {
        html = hljs.highlightAuto(text).value;
      }
    } catch {
      html = '';
    }

    if (!html) return;

    const container = document.createElement('div');
    container.innerHTML = html;

    let offset = 0;
    const walk = (el, activeClasses) => {
      if (el.nodeType === 3) {
        const value = el.nodeValue || '';
        const len = value.length;
        if (len > 0 && activeClasses.length) {
          decorations.push(
            Decoration.inline(pos + 1 + offset, pos + 1 + offset + len, {
              class: activeClasses.join(' '),
            })
          );
        }
        offset += len;
        return;
      }
      if (el.nodeType !== 1) return;
      const classList = String(el.className || '')
        .split(/\s+/)
        .filter(Boolean);
      const nextClasses = classList.length ? activeClasses.concat(classList) : activeClasses;
      el.childNodes.forEach((child) => walk(child, nextClasses));
    };

    container.childNodes.forEach((child) => walk(child, []));
  });

  return DecorationSet.create(doc, decorations);
};

const HighlightJsExtension = Extension.create({
  name: 'highlightjs',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('highlightjs'),
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export default HighlightJsExtension;
