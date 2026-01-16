import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TiptapMarkdownEditor from '../components/TiptapMarkdown';

const DEFAULT_ID = 'mobile-editor';

function postToNative(message) {
  const payload = JSON.stringify(message);
  if (window.ReactNativeWebView?.postMessage) {
    window.ReactNativeWebView.postMessage(payload);
  }
}

function parseMessage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export default function EditorApp() {
  const { t, i18n } = useTranslation();
  const [markdown, setMarkdown] = useState('');
  const [editorId, setEditorId] = useState(DEFAULT_ID);

  const handleIncoming = useCallback(
    (event) => {
      const message = parseMessage(event?.data);
      if (!message) return;
      if (message.type === 'load') {
        const nextId = message.payload?.id || DEFAULT_ID;
        setEditorId(String(nextId));
        setMarkdown(message.payload?.markdown || '');
      }
      if (message.type === 'setLocale') {
        const nextLocale = message.payload?.locale;
        if (nextLocale) {
          i18n.changeLanguage(nextLocale);
        }
      }
    },
    [i18n],
  );

  useEffect(() => {
    window.addEventListener('message', handleIncoming);
    document.addEventListener('message', handleIncoming);
    postToNative({ type: 'ready' });
    return () => {
      window.removeEventListener('message', handleIncoming);
      document.removeEventListener('message', handleIncoming);
    };
  }, [handleIncoming]);

  const handleChange = useCallback((next) => {
    setMarkdown(next);
    postToNative({ type: 'contentChange', payload: { markdown: next } });
  }, []);

  const editorPlaceholder = useMemo(
    () => t('editor.placeholder', 'Type / for commands...'),
    [t],
  );

  return (
    <div className="min-h-screen bg-white text-[#37352f] dark:bg-slate-950 dark:text-slate-100">
      <div className="px-6 py-6 max-w-3xl mx-auto">
        <TiptapMarkdownEditor
          editorId={editorId}
          markdown={markdown}
          onChange={handleChange}
          placeholder={editorPlaceholder}
        />
      </div>
    </div>
  );
}
