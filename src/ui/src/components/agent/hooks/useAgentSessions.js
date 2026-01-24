import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../../api';
import { DEFAULT_CODEX_MODELS, mergeModelDefaults, toModelOptions } from '../constants';

const buildModelOptions = (values) => toModelOptions(values);

export const useAgentSessions = ({ storageKey }) => {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [nextIndex, setNextIndex] = useState(1);
  const [storageReady, setStorageReady] = useState(false);
  const nextIndexRef = useRef(1);
  const [agentModelCatalog, setAgentModelCatalog] = useState(() => ({
    codex: toModelOptions(DEFAULT_CODEX_MODELS),
  }));

  useEffect(() => {
    nextIndexRef.current = nextIndex;
  }, [nextIndex]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let stored = null;
      try {
        stored = await api.loadAgentSessions();
      } catch {
        stored = null;
      }

      if (!stored && typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(storageKey);
          if (raw) {
            stored = JSON.parse(raw);
            if (stored) {
              void api.saveAgentSessions(stored);
            }
          }
        } catch {
          // Ignore storage errors.
        }
      }

      if (cancelled) return;

      const storedSessions = Array.isArray(stored?.sessions) ? stored.sessions : null;
      if (storedSessions) {
        const nextValue = stored?.nextIndex || storedSessions.length + 1;
        const activeValue =
          stored?.activeId && storedSessions.some((session) => session.id === stored.activeId)
            ? stored.activeId
            : storedSessions[0]?.id || null;
        const catalog = {};
        storedSessions.forEach((session) => {
          if (Array.isArray(session.availableModels) && session.availableModels.length) {
            catalog[session.agentId] = session.availableModels;
          }
        });
        setSessions(storedSessions);
        setActiveId(activeValue);
        setNextIndex(nextValue);
        nextIndexRef.current = nextValue;
        setAgentModelCatalog(catalog);
      }

      setStorageReady(true);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!storageReady) return;
    const payload = { sessions, activeId, nextIndex };
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(payload));
        } catch {
          // Ignore storage errors.
        }
      }
      void api.saveAgentSessions(payload);
    }, 600);
    return () => clearTimeout(timer);
  }, [sessions, activeId, nextIndex, storageKey, storageReady]);

  useEffect(() => {
    let cancelled = false;
    api
      .getAgentModelConfig()
      .then((config) => {
        if (cancelled || !config) return;
        const next = {};
        if (Array.isArray(config.codex) && config.codex.length) {
          next.codex = buildModelOptions(mergeModelDefaults(config.codex, DEFAULT_CODEX_MODELS));
        }
        if (Array.isArray(config.claude) && config.claude.length) {
          next.claude = buildModelOptions(config.claude);
        }
        if (Object.keys(next).length) {
          setAgentModelCatalog((prev) => ({ ...prev, ...next }));
        }
      })
      .catch(() => {});

    const handler = (event) => {
      const detail = event?.detail;
      if (!detail) return;
      const next = {};
      if (Array.isArray(detail.codex) && detail.codex.length) {
        next.codex = buildModelOptions(mergeModelDefaults(detail.codex, DEFAULT_CODEX_MODELS));
      }
      if (Array.isArray(detail.claude)) {
        next.claude = buildModelOptions(detail.claude);
      }
      if (Object.keys(next).length) {
        setAgentModelCatalog((prev) => ({ ...prev, ...next }));
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('agent-models-updated', handler);
    }

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('agent-models-updated', handler);
      }
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) || null,
    [sessions, activeId],
  );

  const updateSession = useCallback((sessionId, updater) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const updated = typeof updater === 'function' ? updater(session) : updater;
        return { ...session, ...updated, updatedAt: Date.now() };
      }),
    );
  }, []);

  const appendMessages = useCallback(
    (sessionId, messages) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: [...session.messages, ...messages],
      }));
    },
    [updateSession],
  );

  const updateMessageContent = useCallback(
    (sessionId, messageId, updater) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== messageId) return message;
          const nextContent = typeof updater === 'function' ? updater(message.content) : updater;
          return { ...message, content: nextContent };
        }),
      }));
    },
    [updateSession],
  );

  const updateMessageSummary = useCallback(
    (sessionId, messageId, summary) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== messageId) return message;
          return { ...message, summary };
        }),
      }));
    },
    [updateSession],
  );

  const insertMessageAfter = useCallback(
    (sessionId, afterId, message) => {
      updateSession(sessionId, (session) => {
        const index = session.messages.findIndex((item) => item.id === afterId);
        if (index < 0) {
          return { ...session, messages: [...session.messages, message] };
        }
        const nextMessages = [...session.messages];
        nextMessages.splice(index + 1, 0, message);
        return { ...session, messages: nextMessages };
      });
    },
    [updateSession],
  );

  return {
    sessions,
    setSessions,
    activeId,
    setActiveId,
    nextIndex,
    setNextIndex,
    nextIndexRef,
    agentModelCatalog,
    setAgentModelCatalog,
    activeSession,
    updateSession,
    appendMessages,
    updateMessageContent,
    updateMessageSummary,
    insertMessageAfter,
  };
};
