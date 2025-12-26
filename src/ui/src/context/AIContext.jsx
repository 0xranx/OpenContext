import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../api';
import { parseIdeaRefUrl } from '../utils/ideaRef';
import { IdeaService } from '../services/idea/IdeaService';
import { LocalStorageAdapter } from '../services/idea/LocalStorageAdapter';

const DEFAULT_PROMPT = 'You are an AI within a journaling app. Your job is to help the user reflect on their thoughts in a thoughtful and kind manner. The user can never directly address you or directly respond to you. Try not to repeat what the user said, instead try to seed new ideas, encourage or debate. Keep your responses concise, but meaningful.';

const AIContext = createContext(null);

export function AIContextProvider({ children }) {
  const { i18n } = useTranslation();
  const [config, setConfig] = useState({
    provider: 'openai',
    model: 'gpt-4o',
    apiBase: 'https://api.openai.com/v1',
    hasApiKey: false,
    prompt: DEFAULT_PROMPT,
    defaultPrompt: DEFAULT_PROMPT,
  });
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const docMetaCacheRef = useRef(new Map());
  const ideaThreadCacheRef = useRef(new Map());
  const ideaServiceRef = useRef(null);
  if (!ideaServiceRef.current) {
    ideaServiceRef.current = new IdeaService(new LocalStorageAdapter(api));
  }
  const ideaService = ideaServiceRef.current;

  // Get current language for AI responses
  const currentLanguage = useMemo(() => {
    const lang = i18n.language;
    if (lang?.startsWith('zh')) return 'Chinese (简体中文)';
    if (lang?.startsWith('en')) return 'English';
    return lang || 'English';
  }, [i18n.language]);

  // Load AI config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.getAIConfig();
      setConfig({
        provider: cfg.provider || 'openai',
        model: cfg.model || 'gpt-4o',
        apiBase: cfg.api_base || 'https://api.openai.com/v1',
        hasApiKey: cfg.has_api_key || false,
        apiKeyMasked: cfg.api_key_masked,
        prompt: cfg.prompt || DEFAULT_PROMPT,
        defaultPrompt: cfg.default_prompt || DEFAULT_PROMPT,
      });
    } catch (err) {
      console.error('Failed to load AI config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (updates) => {
    try {
      await api.saveAIConfig(updates);
      await loadConfig(); // Reload after save
      return { success: true };
    } catch (err) {
      console.error('Failed to save AI config:', err);
      return { success: false, error: err.message };
    }
  }, [loadConfig]);

  // Check if AI is available (has API key or using ollama)
  const isAvailable = useMemo(() => {
    if (config.provider === 'ollama') return true;
    return config.hasApiKey;
  }, [config.provider, config.hasApiKey]);

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

  const extractRefs = useCallback((text) => {
    const refs = [];
    if (!text) return refs;
    const regex = /\[([^\]]+)\]\((oc:\/\/[^)]+)\)/g;
    let match = regex.exec(text);
    while (match) {
      refs.push({ label: match[1], href: match[2] });
      match = regex.exec(text);
    }
    return refs;
  }, []);

  const buildReferenceNotes = useCallback(async (text) => {
    const refs = extractRefs(text);
    if (!refs.length) return '';
    const lines = [];
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
        const title = ref.label || meta?.title || meta?.name || meta?.rel_path || 'Doc';
        const description = meta?.description || meta?.desc || '';
        const path = meta?.rel_path || '';
        const summary = [description, path].filter(Boolean).join(' · ');
        lines.push(`- Doc: ${title}${summary ? ` — ${summary}` : ''}`);
        continue;
      }
      if (ref.href.startsWith('oc://idea/')) {
        const parsed = parseIdeaRefUrl(ref.href);
        const threadId = parsed?.threadId || '';
        let thread = ideaThreadCacheRef.current.get(threadId);
        if (!thread && threadId) {
          try {
            thread = await ideaService.getThread(threadId);
            if (thread) ideaThreadCacheRef.current.set(threadId, thread);
          } catch {
            thread = null;
          }
        }
        const firstLine = String(thread?.entries?.[0]?.content || '').split('\n')[0].trim();
        const title = thread?.title || firstLine || ref.label || 'Idea';
        const count = thread?.entries?.length ? ` · ${thread.entries.length} entries` : '';
        lines.push(`- Idea: ${title}${count}`);
        continue;
      }
      lines.push(`- ${ref.label || ref.href}`);
    }
    return lines.length ? `\n\nReferences:\n${lines.join('\n')}` : '';
  }, [extractRefs, parseDocHref, ideaService]);

  // Prepare messages for AI reflection (支持多模态：文本+图片)
  const prepareReflectionContext = useCallback(async (threadEntries) => {
    const messages = [
      { role: 'system', content: config.prompt },
      { role: 'system', content: 'You can only respond in plaintext, do NOT use HTML or Markdown formatting.' },
      { role: 'system', content: `IMPORTANT: You MUST respond in ${currentLanguage}. This is the user's preferred language.` },
    ];

    // Add thread entries as user messages
    for (const entry of threadEntries) {
      const role = 'user';
      const images = entry.images || [];
      const refNotes = await buildReferenceNotes(entry.text || '');
      const entryText = [entry.text || '', refNotes].filter(Boolean).join('');
      
      // 如果有图片，使用多模态消息格式
      if (images.length > 0 && role === 'user') {
        const contentParts = [];
        
        // 添加文本部分
        if (entryText) {
          contentParts.push({ type: 'text', text: entryText });
        }
        
        // 添加图片部分
        for (const img of images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: img }, // img 已经是 base64 格式 data:image/...
          });
        }
        
        messages.push({ role, content: contentParts });
      } else {
        // 纯文本消息
        messages.push({ role, content: entryText || '' });
      }
    }

    return messages;
  }, [config.prompt, currentLanguage, buildReferenceNotes]);

  // Generate AI reflection with streaming
  const generateReflection = useCallback(async (threadEntries, onToken) => {
    if (!isAvailable) {
      throw new Error('AI not configured');
    }

    setIsGenerating(true);
    const messages = await prepareReflectionContext(threadEntries);

    try {
      await api.streamAIChat(messages, (token) => {
        onToken?.(token);
      });
    } finally {
      setIsGenerating(false);
    }
  }, [isAvailable, prepareReflectionContext]);

  const contextValue = useMemo(() => ({
    config,
    loading,
    isGenerating,
    isAvailable,
    loadConfig,
    saveConfig,
    generateReflection,
    prepareReflectionContext,
  }), [config, loading, isGenerating, isAvailable, loadConfig, saveConfig, generateReflection, prepareReflectionContext]);

  return (
    <AIContext.Provider value={contextValue}>
      {children}
    </AIContext.Provider>
  );
}

export function useAI() {
  const context = useContext(AIContext);
  if (!context) {
    throw new Error('useAI must be used within AIContextProvider');
  }
  return context;
}

export default AIContext;
