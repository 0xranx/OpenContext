import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDownIcon,
  SparklesIcon,
  PencilSquareIcon,
  DocumentPlusIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { CustomDialog } from '../Dialogs';
import { AgentMessageList } from './AgentMessageList';
import { AgentInputBar } from './AgentInputBar';
import { AgentSessionSetup } from './AgentSessionSetup';
import { AgentSessionTabs } from './AgentSessionTabs';
import { AgentEmptyState } from './AgentEmptyState';
import {
  DEFAULT_CODEX_MODELS,
  INTENT_CONFIG,
  buildIntentConfig,
  getIntentIcon,
  getIntentLabel,
  getIntentPlaceholder,
} from './constants';
import { useAgentSessions } from './hooks/useAgentSessions';
import { useAgentStreaming } from './hooks/useAgentStreaming';
import * as api from '../../api';
import { writeClipboardText } from '../../utils/clipboard';
import CodexLogo from '../../assets/logos/codex.svg';
import ClaudeLogo from '../../assets/logos/claude.svg';
import OpenCodeLogo from '../../assets/logos/opencode.svg';

const STORAGE_KEY = 'opencontext.agent.sessions.v1';
const SYSTEM_PROMPT = [
  'You are OpenContext Agent.',
  'Help the user with their requests using the selected coding agent.',
  'Be concise and action-oriented. Ask for missing details before acting.',
  'When you need to run OpenContext CLI, include a single line: OC_ACTION: <command args> (do not include "oc").',
].join('\n');
const MAX_CONTEXT_MESSAGES = 12;
const STATUS_LABEL_KEYS = {
  connecting: 'agent.status.connecting',
  connected: 'agent.status.connected',
  authenticating: 'agent.status.authenticating',
  authenticated: 'agent.status.authenticated',
  session_active: 'agent.status.sessionActive',
  error: 'agent.status.error',
  disconnected: 'agent.status.disconnected',
};
const STATUS_COLORS = {
  connecting: 'bg-amber-400',
  connected: 'bg-blue-400',
  authenticating: 'bg-amber-500',
  authenticated: 'bg-emerald-400',
  session_active: 'bg-emerald-500',
  error: 'bg-red-500',
  disconnected: 'bg-zinc-400',
};
const INTENT_CONFIG_WITH_ICONS = buildIntentConfig(INTENT_CONFIG, {
  create: DocumentPlusIcon,
  iterate: PencilSquareIcon,
  search: MagnifyingGlassIcon,
});
const QUICK_ACTIONS = Object.entries(INTENT_CONFIG_WITH_ICONS).map(([id, config]) => ({
  id,
  labelKey: config.labelKey,
  icon: config.icon,
}));
const INTENT_PROMPTS = {
  create: 'You are in the OpenContext create flow. Decide the right time to call oc doc create with the active directory.',
  iterate: 'You are in the OpenContext iterate flow. Decide the right time to call oc doc open on the active document if available.',
  search: 'You are in the OpenContext search flow. Decide the right time to call oc search with the user query.',
};
const AGENT_IDS = ['codex', 'claude', 'opencode'];
const AGENT_PRESETS = [
  { id: 'codex', label: 'Codex', logo: CodexLogo },
  { id: 'claude', label: 'Claude Code', logo: ClaudeLogo },
  { id: 'opencode', label: 'OpenCode', logo: OpenCodeLogo },
];
const MODEL_COPY_KEYS = {
  codex: {
    placeholder: 'agent.modelPlaceholderCodex',
    hint: 'agent.modelHintCodex',
  },
  claude: {
    placeholder: 'agent.modelPlaceholderClaude',
    hint: 'agent.modelHintClaude',
  },
  opencode: {
    placeholder: 'agent.modelPlaceholderOpenCode',
    hint: 'agent.modelHintOpenCode',
  },
  custom: {
    placeholder: 'agent.modelPlaceholderCustom',
    hint: 'agent.modelHintCustom',
  },
};

const buildSessionName = (t, index, agentLabel) =>
  agentLabel ? `${agentLabel} ${index}` : t('agent.sessionDefault', { index });

const sanitizeText = (value) => String(value || '').trim();


const stripIntentCommand = (value) =>
  String(value || '').replace(/^\/opencontext-(create|iterate|search)\s*/i, '').trim();


const resolveIntentFromText = (value) => {
  const lower = String(value || '').toLowerCase();
  if (/\/opencontext-create\b/i.test(lower)) return 'create';
  if (/\/opencontext-iterate\b/i.test(lower)) return 'iterate';
  if (/\/opencontext-search\b/i.test(lower)) return 'search';
  if (/(创建|新建|写一篇|生成).*?(文档|页面|笔记)/.test(value)) return 'create';
  if (/(搜索|查找|检索)/.test(value)) return 'search';
  if (/(编辑|迭代|润色|完善|改写)/.test(value)) return 'iterate';
  if (/create\s+(doc|document|note)/.test(lower)) return 'create';
  if (/search\s+/.test(lower)) return 'search';
  if (/iterate|edit\s+(doc|document|note)/.test(lower)) return 'iterate';
  return null;
};

const deriveDocName = (value) => {
  const trimmed = sanitizeText(value);
  if (!trimmed) return '';
  const quoted = trimmed.match(/“([^”]+)”|"([^"]+)"/);
  if (quoted) return (quoted[1] || quoted[2] || '').trim();
  const afterCreate = trimmed.match(/(?:创建|新建|写一篇|生成)\s*([^，。,.]+?)(?:文档|页面|笔记)?$/);
  if (afterCreate) return afterCreate[1].trim();
  return trimmed.split('\n')[0].slice(0, 40).trim();
};

const buildContextBlock = (selectedDoc) => {
  if (!selectedDoc) return '';
  const relPath = selectedDoc.rel_path || selectedDoc.relPath || '';
  const stableId = selectedDoc.stable_id || selectedDoc.stableId || '';
  const description = selectedDoc.description || '';
  const activeDir = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
  const lines = [];
  if (relPath) lines.push(`active_doc: ${relPath}`);
  if (activeDir) lines.push(`active_dir: ${activeDir}`);
  if (stableId) lines.push(`active_doc_id: ${stableId}`);
  if (description) lines.push(`selection_hint: ${description}`);
  if (!lines.length) return '';
  return `[OpenContext Context]\n${lines.join('\n')}`;
};

const deriveSessionTitle = (value) => {
  const trimmed = sanitizeText(value);
  if (!trimmed) return '';
  return trimmed.split('\n')[0].substring(0, 50).trim();
};

const splitCommandArgs = (value) => {
  const input = String(value || '').trim();
  if (!input) return [];
  const args = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = matcher.exec(input);
  while (match) {
    args.push(match[1] || match[2] || match[3]);
    match = matcher.exec(input);
  }
  return args;
};

const extractOcAction = (value) => {
  const text = String(value || '');
  if (!text) return { args: null, cleaned: text };
  const lines = text.split('\n');
  let action = null;
  const kept = [];
  lines.forEach((line) => {
    const match = line.match(/^\s*OC_ACTION:\s*(.+)$/i);
    if (match && !action) {
      action = match[1].trim();
    } else {
      kept.push(line);
    }
  });
  const cleaned = kept.join('\n').trimEnd();
  if (!action) return { args: null, cleaned };
  const normalized = action.replace(/^oc\s+/i, '').trim();
  const args = splitCommandArgs(normalized);
  return { args: args.length ? args : null, cleaned };
};

const createMessage = (partial) => ({
  id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role: 'assistant',
  kind: 'text',
  content: '',
  createdAt: Date.now(),
  ...partial,
});

const normalizeModelOptions = (modelsPayload) => {
  const available = modelsPayload?.availableModels;
  if (!Array.isArray(available)) return [];
  return available
    .map((model) => {
      const value = model?.modelId || model?.id || model?.value || '';
      if (!value) return null;
      return {
        value,
        label: model?.name || model?.label || value,
      };
    })
    .filter(Boolean);
};

const formatElapsed = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const resolveModelCopyKey = (agentId, type) => {
  const resolved = MODEL_COPY_KEYS[agentId] ? agentId : 'codex';
  return MODEL_COPY_KEYS[resolved][type];
};

export default function AgentSidebar({
  width,
  height,
  orientation = 'vertical',
  selectedDoc,
}) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [dialog, setDialog] = useState(null);
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [selectedAgentPreset, setSelectedAgentPreset] = useState('codex');
  const [customAgentLabel, setCustomAgentLabel] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [toast, setToast] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showIntentMenu, setShowIntentMenu] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [expandedToolMessages, setExpandedToolMessages] = useState(() => new Set());
  const [expandedThoughtMessages, setExpandedThoughtMessages] = useState(() => new Set());
  const scrollAnchorRef = useRef(null);
  const messageContainerRef = useRef(null);
  const inputRef = useRef(null);
  const inputContainerRef = useRef(null);
  const intentMenuRef = useRef(null);
  const {
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
  } = useAgentSessions({ storageKey: STORAGE_KEY });

  // 当没有会话时，自动打开新建会话页面
  useEffect(() => {
    if (sessions.length === 0) {
      setCreateViewOpen(true);
    }
  }, [sessions.length]);

  // activeSession 已由 useAgentSessions 计算

  const scrollToBottom = useCallback((behavior = 'auto') => {
    if (!messageContainerRef.current) return;
    messageContainerRef.current.scrollTo({
      top: messageContainerRef.current.scrollHeight,
      behavior,
    });
  }, []);

  useEffect(() => {
    if (!scrollAnchorRef.current) return;
    if (!activeSession) return;
    const lastMessage = activeSession.messages[activeSession.messages.length - 1];
    const isUserMessage = lastMessage?.role === 'user';
    if (isUserMessage || atBottom) {
      scrollToBottom('auto');
    }
  }, [activeSession?.messages?.length, activeSession, atBottom, scrollToBottom]);

  useEffect(() => {
    if (!messageContainerRef.current) return;
    const container = messageContainerRef.current;
    const handleScroll = () => {
      const threshold = 64;
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const isAtBottom = distance <= threshold;
      setAtBottom(isAtBottom);
      setShowScrollButton(!isAtBottom);
    };
    const frame = requestAnimationFrame(handleScroll);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [createViewOpen, activeSession?.id, activeSession?.messages?.length]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showIntentMenu) return;
    const handleClick = (event) => {
      if (intentMenuRef.current && !intentMenuRef.current.contains(event.target)) {
        setShowIntentMenu(false);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mousedown', handleClick);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousedown', handleClick);
      }
    };
  }, [showIntentMenu]);

  const modelPlaceholder = useMemo(() => {
    return t(resolveModelCopyKey(selectedAgentPreset, 'placeholder'));
  }, [selectedAgentPreset, t]);

  const activeModelPlaceholder = useMemo(() => {
    return t(resolveModelCopyKey(activeSession?.agentId, 'placeholder'));
  }, [activeSession?.agentId, t]);

  const modelHint = useMemo(() => {
    return t(resolveModelCopyKey(selectedAgentPreset, 'hint'));
  }, [selectedAgentPreset, t]);

  const statusLabel = useMemo(() => {
    const statusKey = activeSession?.status;
    if (!statusKey) return '';
    const labelKey = STATUS_LABEL_KEYS[statusKey];
    if (!labelKey) return '';
    return t(labelKey);
  }, [activeSession?.status, t]);

  const isAgentSession = useMemo(() => {
    const agentId = activeSession?.agentId;
    return Boolean(agentId && AGENT_IDS.includes(agentId));
  }, [activeSession?.agentId]);

  const isInputReady = useMemo(() => {
    if (!activeSession) return false;
    if (!isAgentSession) return true;
    return ['authenticated', 'session_active'].includes(activeSession.status);
  }, [activeSession, isAgentSession]);

  const showAuthGate = Boolean(activeSession && isAgentSession && !isInputReady);
  const showAuthGateInEmpty = Boolean(showAuthGate && activeSession?.messages.length === 0);

  const startAgentPreflight = useCallback(
    (sessionId, agentId, model) => {
      const requestId = `preflight-${sessionId}`;
      let unlisten = null;
      api
        .listenAgentStream(requestId, (payload) => {
          if (!payload) return;
          if (payload.status && STATUS_LABEL_KEYS[payload.status]) {
            updateSession(sessionId, { status: payload.status });
          }
          if (payload.models) {
            const options = normalizeModelOptions(payload.models);
            if (options.length) {
              setAgentModelCatalog((prev) => ({
                ...prev,
                [agentId]: options,
              }));
              updateSession(sessionId, (session) => {
                const next = { availableModels: options };
                if (!session.model && payload.models?.currentModelId) {
                  return { ...next, model: payload.models.currentModelId };
                }
                return next;
              });
            }
          }
          if (payload.error) {
            updateSession(sessionId, { status: 'error' });
            appendMessages(sessionId, [
              createMessage({
                role: 'tool',
                kind: 'tool',
                content: t('agent.toolError', { message: payload.error }),
              }),
            ]);
          }
          if (payload.done && unlisten) {
            unlisten();
            unlisten = null;
          }
        })
        .then((unlistenFn) => {
          unlisten = unlistenFn;
        })
        .catch(() => {});

      api
        .preflightAgentSession({
          sessionId,
          agentId,
          model: model || undefined,
        })
        .catch((error) => {
          updateSession(sessionId, { status: 'error' });
          appendMessages(sessionId, [
            createMessage({
              role: 'tool',
              kind: 'tool',
              content: t('agent.toolError', { message: error.message || String(error) }),
            }),
          ]);
        });
    },
    [appendMessages, t, updateSession, setAgentModelCatalog],
  );

  const handleSessionModelChange = useCallback(
    (nextValue) => {
      if (!activeSession) return;
      const trimmed = sanitizeText(nextValue);
      if (trimmed === activeSession.model) return;
      updateSession(activeSession.id, { model: trimmed });
      if (isAgentSession) {
        updateSession(activeSession.id, { status: 'connecting' });
        startAgentPreflight(activeSession.id, activeSession.agentId, trimmed);
      }
    },
    [activeSession, isAgentSession, startAgentPreflight, updateSession],
  );

  const contextBlock = useMemo(() => buildContextBlock(selectedDoc), [selectedDoc]);

  const buildModelMessages = useCallback((session, messages, extraSystem) => {
    const agentLabel = session?.agentLabel || session?.agentId || '';
    const agentLine = agentLabel ? `Active coding agent: ${agentLabel}` : '';
    const filtered = messages
      .filter((message) => message.kind === 'text' && (message.role === 'user' || message.role === 'assistant'))
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((message) => ({
        role: message.role,
        content: message.content || '',
      }));
    return [
      { role: 'system', content: [SYSTEM_PROMPT, agentLine, extraSystem].filter(Boolean).join('\n\n') },
      ...filtered,
    ];
  }, []);

  const {
    isGenerating,
    generatingSessionId,
    reasoningText,
    elapsedSeconds,
    isThoughtRunning,
    activeThoughtMessageRef,
    handleSend,
    handleStop,
    handleKeyDown,
  } = useAgentStreaming({
    t,
    inputValue,
    setInputValue,
    activeSession,
    isInputReady,
    contextBlock,
    buildModelMessages,
    updateSession,
    appendMessages,
    updateMessageContent,
    updateMessageSummary,
    insertMessageAfter,
    setExpandedThoughtMessages,
    resolveIntentFromText,
    deriveSessionTitle,
    extractOcAction,
    sanitizeText,
    intentPrompts: INTENT_PROMPTS,
    statusLabelKeys: STATUS_LABEL_KEYS,
    createMessage,
    setDialog,
    isComposing,
  });

  const renderAuthGateCard = useCallback(
    (variant) => {
      const isLarge = variant === 'large';
      const agentLabel = activeSession?.agentLabel || activeSession?.agentId || '';
      const statusKey = activeSession?.status;
      const statusColor = (statusKey && STATUS_COLORS[statusKey]) || 'bg-zinc-400';
      const showSpinner = ['connecting', 'connected', 'authenticating'].includes(statusKey);
      return (
        <div
          className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-center shadow-sm ${
            isLarge ? 'px-6 py-6' : 'px-5 py-4'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            {showSpinner && (
              <span className="h-4 w-4 rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-200 animate-spin" />
            )}
            <div
              className={`${isLarge ? 'text-lg' : 'text-base'} font-semibold text-zinc-700 dark:text-zinc-200`}
            >
              {t('agent.authGateTitle', { agent: agentLabel })}
            </div>
          </div>
          <div className={`mt-2 ${isLarge ? 'text-sm' : 'text-sm'} text-zinc-500 dark:text-zinc-400`}>
            {statusLabel ? (
              <span className="inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                <span>{t('agent.authGateStatus', { status: statusLabel })}</span>
              </span>
            ) : (
              t('agent.authGateBody')
            )}
          </div>
          <div className={`mt-1 ${isLarge ? 'text-xs' : 'text-xs'} text-zinc-400 dark:text-zinc-500`}>
            {t('agent.authGateBody')}
          </div>
        </div>
      );
    },
    [activeSession?.agentId, activeSession?.agentLabel, activeSession?.status, statusLabel, t],
  );

  const resolveAgentLabel = () => {
    const preset = AGENT_PRESETS.find((item) => item.id === selectedAgentPreset);
    if (!preset) return '';
    if (preset.id === 'custom') return sanitizeText(customAgentLabel);
    return preset.label || (preset.labelKey ? t(preset.labelKey) : preset.id);
  };

  const modelOptions = useMemo(() => {
    return agentModelCatalog[selectedAgentPreset] || [];
  }, [agentModelCatalog, selectedAgentPreset]);

  const activeModelOptions = useMemo(() => {
    if (!activeSession) return [];
    if (Array.isArray(activeSession.availableModels) && activeSession.availableModels.length) {
      return activeSession.availableModels;
    }
    return agentModelCatalog[activeSession.agentId] || [];
  }, [activeSession, agentModelCatalog]);

  const activeIntent = activeSession?.intent || null;
  const intentLabel = useMemo(
    () => getIntentLabel(t, activeIntent, INTENT_CONFIG_WITH_ICONS),
    [t, activeIntent],
  );
  const intentIcon = useMemo(
    () => getIntentIcon(activeIntent, INTENT_CONFIG_WITH_ICONS, SparklesIcon),
    [activeIntent],
  );
  const inputPlaceholder = useMemo(
    () => getIntentPlaceholder(t, activeIntent, INTENT_CONFIG_WITH_ICONS),
    [t, activeIntent],
  );
  const IntentIcon = intentIcon;

  useEffect(() => {
    if (modelInput) return;
    if (!modelOptions.length) return;
    setModelInput(modelOptions[0].value);
  }, [modelInput, modelOptions]);

  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.model) return;
    if (!activeModelOptions.length) return;
    updateSession(activeSession.id, { model: activeModelOptions[0].value });
  }, [activeModelOptions, activeSession, updateSession]);

  const handleQuickAction = useCallback(
    (intentId) => {
      if (!activeSession) return;
      updateSession(activeSession.id, (session) => ({
        intent: session.intent === intentId ? null : intentId,
      }));
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    [activeSession, updateSession],
  );

  const handleCreateSession = () => {
    const agentLabel = resolveAgentLabel();
    if (!agentLabel && selectedAgentPreset === 'custom') {
      setToast(t('agent.missingAgent'));
      return;
    }
    const model = sanitizeText(modelInput);
    const index = nextIndexRef.current;
    const shouldPreflight = AGENT_IDS.includes(selectedAgentPreset);
    const session = {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: buildSessionName(t, index, agentLabel),
      agentId: selectedAgentPreset,
      agentLabel,
      model: model || '',
      status: shouldPreflight ? 'connecting' : undefined,
      availableModels: modelOptions,
      intent: null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      autoTitle: true,
    };
    setSessions((prev) => [...prev, session]);
    setActiveId(session.id);
    setNextIndex(index + 1);
    setCreateViewOpen(false);
    setCustomAgentLabel('');
    setModelInput('');
    if (shouldPreflight) {
      startAgentPreflight(session.id, session.agentId, session.model);
    }
  };

  const handleRenameSession = (session) => {
    if (!session) return;
    setDialog({
      isOpen: true,
      type: 'prompt',
      title: t('agent.renameTitle'),
      placeholder: t('agent.renamePlaceholder'),
      initialValue: session.name,
      onConfirm: (value) => {
        const nextName = sanitizeText(value);
        if (!nextName) return;
        updateSession(session.id, { name: nextName });
        updateSession(session.id, { autoTitle: false });
      },
    });
  };

  const handleDeleteSession = (session) => {
    if (!session) return;
    setDialog({
      isOpen: true,
      type: 'confirm',
      title: t('agent.deleteTitle'),
      message: t('agent.deleteMessage', { name: session.name }),
      confirmText: t('common.delete'),
      isDestructive: true,
      onConfirm: () => {
        setSessions((prev) => {
          const next = prev.filter((item) => item.id !== session.id);
          setActiveId((current) => (current === session.id ? next[0]?.id || null : current));
          return next;
        });
      },
    });
  };

  const getActiveDir = useCallback(() => {
    const relPath = selectedDoc?.rel_path || selectedDoc?.relPath || '';
    if (!relPath) return '.';
    if (!relPath.includes('/')) return '.';
    return relPath.split('/').slice(0, -1).join('/');
  }, [selectedDoc]);

  const buildOcCommand = useCallback(
    (intent, messageText) => {
      if (!intent) return null;
      const cleaned = stripIntentCommand(messageText || '');
      if (intent === 'search') {
        if (!cleaned) return null;
        return ['search', cleaned];
      }
      if (intent === 'create') {
        const folder = getActiveDir();
        const name = deriveDocName(cleaned) || `Untitled-${Date.now()}`;
        return ['doc', 'create', folder, name];
      }
      if (intent === 'iterate') {
        const stableId = selectedDoc?.stable_id || selectedDoc?.stableId || '';
        if (!stableId) return null;
        return ['doc', 'open', stableId];
      }
      return null;
    },
    [getActiveDir, selectedDoc],
  );


  const handleCopyMessage = useCallback(
    async (content) => {
      if (!content) return;
      try {
        await writeClipboardText(content);
        setToast(t('error.copied'));
      } catch {
        setToast(t('error.copyFailed'));
      }
    },
    [t],
  );

  const toggleToolMessage = useCallback((messageId) => {
    setExpandedToolMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const toggleThoughtMessage = useCallback((messageId) => {
    setExpandedThoughtMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!inputRef.current) return;
    const node = inputRef.current;
    node.style.height = 'auto';
    const newHeight = Math.min(node.scrollHeight, 200);
    // Ensure minimum height (e.g. 24px or roughly one line)
    node.style.height = `${Math.max(newHeight, 24)}px`;
    node.style.overflowY = node.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [inputValue]);

  return (
    <>
      <aside
        style={{
          width: orientation === 'vertical' ? width : '100%',
          height: orientation === 'horizontal' ? height : '100%',
        }}
        className={`
          flex-shrink-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 flex flex-col min-h-0 transition-colors duration-200
          ${orientation === 'vertical' ? 'border-l h-full' : 'border-t w-full'}
          border-zinc-200 dark:border-zinc-800
        `}
      >
        <AgentSessionTabs
          sessions={sessions}
          activeId={activeId}
          setActiveId={setActiveId}
          createViewOpen={createViewOpen}
          setCreateViewOpen={setCreateViewOpen}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          t={t}
        />

        {createViewOpen ? (
          <AgentSessionSetup
            t={t}
            agentPresets={AGENT_PRESETS}
            selectedAgentPreset={selectedAgentPreset}
            setSelectedAgentPreset={setSelectedAgentPreset}
            modelOptions={modelOptions}
            modelInput={modelInput}
            setModelInput={setModelInput}
            modelPlaceholder={modelPlaceholder}
            modelHint={modelHint}
            customAgentLabel={customAgentLabel}
            setCustomAgentLabel={setCustomAgentLabel}
            onCreateSession={handleCreateSession}
          />
        ) : (
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-zinc-900">
            <div ref={messageContainerRef} className="flex-1 overflow-y-auto px-3 pt-4 pb-4 scroll-smooth">
              <AgentEmptyState
                activeSession={activeSession}
                showAuthGateInEmpty={showAuthGateInEmpty}
                renderAuthGateCard={renderAuthGateCard}
                setCreateViewOpen={setCreateViewOpen}
                t={t}
              />

              <AgentMessageList
                activeSession={activeSession}
                isGenerating={isGenerating}
                expandedToolMessages={expandedToolMessages}
                expandedThoughtMessages={expandedThoughtMessages}
                onToggleTool={toggleToolMessage}
                onToggleThought={toggleThoughtMessage}
                onCopy={handleCopyMessage}
                t={t}
                activeThoughtMessageRef={activeThoughtMessageRef}
              />

              {/* Generating indicator - Minimalist (Text only) */}
              {isThoughtRunning && (
                <div className="max-w-[780px] mx-auto px-4 mb-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
                  <div className="flex items-center gap-2 w-fit opacity-70 hover:opacity-100 transition-opacity select-none">
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      {reasoningText ? t('agent.statusThinking') : t('agent.statusGenerating')}
                    </span>

                    {/* Animated dots */}
                    <div className="flex items-center gap-0.5 mt-0.5">
                      <span className="h-0.5 w-0.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-0.5 w-0.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-0.5 w-0.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce" />
                    </div>
                    
                    {/* Timer */}
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 tabular-nums">
                      {formatElapsed(elapsedSeconds)}
                    </span>

                    {/* Stop button - Icon only, subtle hover */}
                    <button
                      type="button"
                      onClick={handleStop}
                      className="ml-1 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors flex items-center justify-center"
                      title={t('agent.stop')}
                    >
                      <div className="h-1.5 w-1.5 rounded-[0.5px] bg-current" />
                    </button>
                  </div>
                </div>
              )}

              <div ref={scrollAnchorRef} />
            </div>

            {showScrollButton && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 animate-in fade-in zoom-in-95 duration-200 pointer-events-none">
                <button
                  type="button"
                  className="pointer-events-auto flex items-center justify-center h-8 w-8 rounded-full bg-white/90 dark:bg-zinc-800/90 shadow-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-all hover:scale-105 active:scale-95 backdrop-blur-sm"
                  onClick={() => scrollToBottom('smooth')}
                  title={t('agent.scrollToBottom')}
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {!createViewOpen && (
          <div className="px-5 pb-6 pt-2 bg-white dark:bg-zinc-900">
            {showAuthGate ? (
              showAuthGateInEmpty ? null : renderAuthGateCard('compact')
            ) : (
              <div
                ref={inputContainerRef}
                className={`rounded-[20px] border px-3 py-3 bg-white dark:bg-zinc-950 transition-all duration-200 ease-out mx-1 ${
                  isInputFocused
                    ? 'border-zinc-300 dark:border-zinc-700 shadow-sm ring-1 ring-zinc-100 dark:ring-zinc-800'
                    : 'border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <AgentInputBar
                  inputRef={inputRef}
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                  inputPlaceholder={inputPlaceholder}
                  isInputReady={isInputReady}
                  isGenerating={isGenerating}
                  isComposing={isComposing}
                  setIsComposing={setIsComposing}
                  setIsInputFocused={setIsInputFocused}
                  activeSession={activeSession}
                  handleKeyDown={handleKeyDown}
                  handleStop={handleStop}
                  handleSend={handleSend}
                  activeIntent={activeIntent}
                  intentLabel={intentLabel}
                  IntentIcon={IntentIcon}
                  showIntentMenu={showIntentMenu}
                  setShowIntentMenu={setShowIntentMenu}
                  handleQuickAction={handleQuickAction}
                  intentMenuRef={intentMenuRef}
                  t={t}
                  activeModelOptions={activeModelOptions}
                  handleSessionModelChange={handleSessionModelChange}
                  activeModelPlaceholder={activeModelPlaceholder}
                  isAgentSession={isAgentSession}
                  showAuthGate={showAuthGate}
                  quickActions={QUICK_ACTIONS}
                />
              </div>
          )}
        </div>
      )}
    </aside>

      {dialog?.isOpen && (
        <CustomDialog
          isOpen={dialog.isOpen}
          type={dialog.type}
          title={dialog.title}
          message={dialog.message}
          placeholder={dialog.placeholder}
          initialValue={dialog.initialValue}
          confirmText={dialog.confirmText}
          cancelText={dialog.cancelText}
          isDestructive={dialog.isDestructive}
          onConfirm={dialog.onConfirm}
          onCancel={dialog.onCancel}
          onClose={() => setDialog(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[240] px-3 py-2 rounded-md bg-black/80 text-white text-xs shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
