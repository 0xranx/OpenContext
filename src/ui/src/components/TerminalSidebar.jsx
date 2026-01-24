import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon, XMarkIcon, CommandLineIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useTheme } from '../context/ThemeContext';
import 'xterm/css/xterm.css';
import * as api from '../api';
import i18n from '../i18n';

const CLI_PRESETS = [
  { id: 'codex', label: 'OpenAI Codex', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'custom', labelKey: 'terminal.custom', command: '' },
];

const THEME_CONFIG = {
  light: {
    background: '#ffffff',
    foreground: '#18181b', // zinc-900
    cursor: '#18181b',
    selectionBackground: 'rgba(24, 24, 27, 0.1)',
    black: '#000000',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#d4d4d8',
    brightBlack: '#71717a',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  },
  dark: {
    background: '#09090b', // zinc-950
    foreground: '#e4e4e7', // zinc-200
    cursor: '#e4e4e7',
    selectionBackground: 'rgba(148, 163, 184, 0.35)',
    black: '#000000',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#d4d4d8',
    brightBlack: '#71717a',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  },
};

const detectTauri = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.__TAURI_IPC__);
};

const termEntries = new Map();
const outputCache = new Map();
const listeners = new Set();
const storeState = {
  terminals: [],
  activeId: null,
  envInfo: null,
  nextIndex: 1,
};
let tauriListenersReady = false;
let tauriListenersPromise = null;

const getSnapshot = () => ({
  terminals: storeState.terminals,
  activeId: storeState.activeId,
  envInfo: storeState.envInfo,
});

const emit = () => {
  const snapshot = getSnapshot();
  listeners.forEach((listener) => listener(snapshot));
};

const subscribeStore = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setState = (partial) => {
  if (partial.terminals !== undefined) storeState.terminals = partial.terminals;
  if (partial.activeId !== undefined) storeState.activeId = partial.activeId;
  if (partial.envInfo !== undefined) storeState.envInfo = partial.envInfo;
  emit();
};

const updateTerminals = (updater) => {
  const next = typeof updater === 'function' ? updater(storeState.terminals) : updater;
  setState({ terminals: next });
};

const detachAllTerminals = () => {
  termEntries.forEach((entry) => {
    entry.resizeObserver?.disconnect();
    entry.resizeObserver = null;
    entry.container = null;
    entry.opened = false;
  });
};

const ensureTauriListeners = async () => {
  if (tauriListenersReady) return;
  if (!detectTauri()) return;
  if (tauriListenersPromise) return tauriListenersPromise;
  tauriListenersPromise = (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen('terminal-output', (event) => {
        const payload = event.payload || {};
        const entry = termEntries.get(payload.id);
        if (!entry) return;
        const raw = typeof payload.data === 'string' ? payload.data : payload.data || '';
        const now = Date.now();
        const cache = outputCache.get(payload.id) || { last: '', ts: 0 };
        if (raw === cache.last && now - cache.ts < 30) {
          return;
        }
        outputCache.set(payload.id, { last: raw, ts: now });
        entry.term.write(raw);
      });
      await listen('terminal-exit', (event) => {
        const payload = event.payload || {};
        if (!payload.id) return;
        updateTerminals((prev) => prev.map((terminal) => (
          terminal.id === payload.id
            ? { ...terminal, status: 'closed' }
            : terminal
        )));
        const entry = termEntries.get(payload.id);
        if (entry) {
          entry.term.writeln(`\r\n${i18n.t('terminal.processExited', { code: payload.code ?? 'unknown' })}`);
        }
      });
    } catch {
      // ignore
    }
    tauriListenersReady = true;
  })();
  return tauriListenersPromise;
};

export default function TerminalSidebar({ 
  width, 
  height, 
  orientation = 'vertical', // 'vertical' | 'horizontal'
  onToggleLayout,
  onSwitchToAgent,
}) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [snapshot, setSnapshot] = useState(() => getSnapshot());
  const { terminals, activeId, envInfo } = snapshot;
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('codex');
  const [customCommand, setCustomCommand] = useState('');
  const [createError, setCreateError] = useState('');
  const isTauri = detectTauri();

  useEffect(() => {
    const unsubscribe = subscribeStore(setSnapshot);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (storeState.envInfo) return;
    let mounted = true;
    api.getEnvInfo().then((info) => {
      if (mounted) setState({ envInfo: info });
    }).catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    ensureTauriListeners();
  }, [isTauri]);

  useEffect(() => {
    return () => {
      detachAllTerminals();
    };
  }, []);

  const activeTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === activeId),
    [terminals, activeId]
  );

  const resizeTerminal = useCallback((id) => {
    const entry = termEntries.get(id);
    if (!entry || !entry.opened) return;
    entry.fitAddon.fit();
    api.resizeTerminal(id, { cols: entry.term.cols, rows: entry.term.rows }).catch(() => {});
  }, []);

  const attachTerminal = useCallback((id) => (node) => {
    const entry = termEntries.get(id);
    if (!entry) return;
    if (!node) {
      entry.resizeObserver?.disconnect();
      entry.resizeObserver = null;
      entry.container = null;
      entry.opened = false;
      return;
    }
    if (entry.container === node && entry.opened) return;
    entry.resizeObserver?.disconnect();
    entry.container = node;
    if (entry.term.element && entry.term.element.parentElement !== node) {
      node.innerHTML = '';
      node.appendChild(entry.term.element);
    } else if (!entry.term.element) {
      entry.term.open(node);
    }
    entry.opened = true;
    resizeTerminal(id);
    requestAnimationFrame(() => resizeTerminal(id));
    setTimeout(() => resizeTerminal(id), 60);
    if (typeof ResizeObserver !== 'undefined') {
      entry.resizeObserver = new ResizeObserver(() => resizeTerminal(id));
      entry.resizeObserver.observe(node);
    }
  }, [resizeTerminal]);

  useEffect(() => {
    if (!activeId) return;
    const handle = requestAnimationFrame(() => resizeTerminal(activeId));
    return () => cancelAnimationFrame(handle);
  }, [activeId, resizeTerminal]);

  useEffect(() => {
    const onResize = () => {
      if (activeId) resizeTerminal(activeId);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeId, resizeTerminal]);

  useEffect(() => {
    // Update theme for all existing terminals
    const theme = THEME_CONFIG[resolvedTheme] || THEME_CONFIG.light;
    termEntries.forEach((entry) => {
      entry.term.options.theme = theme;
    });
  }, [resolvedTheme]);

  const createTerminalInstance = useCallback((id) => {
    const term = new Terminal({
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      letterSpacing: 0,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      cursorBlink: true,
      theme: THEME_CONFIG[resolvedTheme] || THEME_CONFIG.light,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.onData((data) => {
      const normalized = data.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
      api.writeTerminal(id, normalized).catch(() => {});
    });
    termEntries.set(id, {
      term,
      fitAddon,
      opened: false,
      container: null,
      resizeObserver: null,
    });
    return term;
  }, []);

  const ensureTerminalSize = async (id) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const entry = termEntries.get(id);
      if (entry?.opened) {
        resizeTerminal(id);
        return { cols: entry.term.cols, rows: entry.term.rows };
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return { cols: 80, rows: 24 };
  };

  const resolveInitTools = (presetId) => {
    if (presetId === 'codex') return '--tools codex';
    if (presetId === 'claude') return '--tools claude';
    return '--tools none';
  };

  const resolveCwd = () => {
    const contextsRoot = envInfo?.contexts_root;
    if (contextsRoot) {
      const withoutContexts = contextsRoot.replace(/[\\/]contexts[\\/]?$/, '');
      return withoutContexts && withoutContexts !== contextsRoot ? withoutContexts : contextsRoot;
    }
    const dbPath = envInfo?.db_path;
    if (dbPath) {
      return dbPath.replace(/[\\/][^\\/]+$/, '');
    }
    return undefined;
  };

  const spawnTerminal = async (cliCommand, presetId) => {
    if (!isTauri) {
      setCreateError(t('terminal.desktopOnly'));
      return;
    }
    const trimmed = cliCommand.trim();
    const parts = trimmed.split(' ').filter(Boolean);
    const baseCommand = parts[0];
    if (!baseCommand) {
      setCreateError(t('terminal.provideCommand'));
      return;
    }
    const platform = typeof navigator !== 'undefined'
      ? (navigator.platform || navigator.userAgent || '')
      : '';
    const isWindows = /win/i.test(platform);
    const isMac = /mac/i.test(platform);
    const initTools = resolveInitTools(presetId);
    const initCommand = `oc init ${initTools}`.trim();
    const shellCommand = isWindows
      ? `${initCommand} && ${trimmed}`
      : `${initCommand} && exec ${trimmed}`;
    const command = isWindows ? 'cmd' : (isMac ? 'zsh' : 'bash');
    const args = isWindows ? ['/c', shellCommand] : ['-ic', shellCommand];

    const index = storeState.nextIndex++;
    const name = `Terminal ${index}`;
    const cwd = resolveCwd();
    const id = `term-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const term = createTerminalInstance(id);

    setState({
      terminals: [
        ...storeState.terminals,
        { id, name, cliCommand, status: 'starting' },
      ],
      activeId: id,
    });
    setShowCreate(false);
    setCreateError('');

    try {
      const size = await ensureTerminalSize(id);
      await api.spawnTerminal({
        id,
        command,
        args,
        cwd,
        cols: size.cols,
        rows: size.rows,
        env: {
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });
      term.writeln(t('terminal.starting', { command: cliCommand }));
      updateTerminals((prev) => prev.map((terminal) => (
        terminal.id === id ? { ...terminal, status: 'running' } : terminal
      )));
    } catch (error) {
      term.writeln(t('terminal.startFailed', { error: error?.message || error }));
      updateTerminals((prev) => prev.map((terminal) => (
        terminal.id === id ? { ...terminal, status: 'error' } : terminal
      )));
      setCreateError(error?.message || t('terminal.startFailed', { error: '' }));
    }
  };

  const handleCreate = async () => {
    const preset = CLI_PRESETS.find((item) => item.id === selectedPreset);
    const command = preset?.id === 'custom'
      ? customCommand.trim()
      : preset?.command;
    await spawnTerminal(command || '', preset?.id);
  };

  const closeTerminal = (id) => {
    api.killTerminal(id).catch(() => {});
    const entry = termEntries.get(id);
    if (entry) {
      entry.resizeObserver?.disconnect();
      entry.term.dispose();
      termEntries.delete(id);
    }
    const next = storeState.terminals.filter((terminal) => terminal.id !== id);
    const nextActive = storeState.activeId === id ? next[0]?.id || null : storeState.activeId;
    setState({ terminals: next, activeId: nextActive });
  };

  const getScrollbarStyle = () => {
    const isDark = resolvedTheme === 'dark';
    const thumbColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const thumbHoverColor = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)';
    const trackBorderColor = isDark ? '#09090b' : '#ffffff';

    return `
      .xterm-viewport::-webkit-scrollbar {
        width: 10px;
      }
      .xterm-viewport::-webkit-scrollbar-track {
        background: transparent;
      }
      .xterm-viewport::-webkit-scrollbar-thumb {
        background-color: ${thumbColor};
        border-radius: 5px;
        border: 2px solid ${trackBorderColor};
      }
      .xterm-viewport::-webkit-scrollbar-thumb:hover {
        background-color: ${thumbHoverColor};
      }
    `;
  };

  const renderEmpty = () => (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-gray-50/50 dark:bg-zinc-900/50">
      <div className="w-16 h-16 mb-4 rounded-2xl bg-white border border-gray-200 shadow-sm dark:bg-zinc-800 dark:border-zinc-700 flex items-center justify-center">
        <CommandLineIcon className="w-8 h-8 text-gray-400 dark:text-zinc-500" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-1">
        {t('terminal.noTerminals')}
      </h3>
      <p className="text-xs text-gray-500 dark:text-zinc-400 mb-6 max-w-[200px] leading-relaxed">
        {t('terminal.emptyDescription')}
      </p>
      <button
        type="button"
        onClick={() => {
          setSelectedPreset('codex');
          setCustomCommand('');
          setCreateError('');
          setShowCreate(true);
        }}
        className="px-4 py-2 text-xs font-medium rounded-md shadow-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-700 transition-colors"
      >
        {t('terminal.newTerminal')}
      </button>
    </div>
  );

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
        <div className="flex items-center justify-between px-2 border-b border-zinc-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/50 h-12 flex-shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 mr-2 h-full">
            {terminals.length === 0 && (
              <div className="text-xs font-medium text-zinc-400 dark:text-zinc-500 px-2 select-none">
                {t('terminal.title')}
              </div>
            )}
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className={`flex-shrink-0 flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer ${
                  activeId === terminal.id
                    ? 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 shadow-sm'
                    : 'bg-transparent border-transparent text-zinc-500 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
                }`}
                onClick={() => setState({ activeId: terminal.id })}
              >
                <span className="truncate max-w-[120px] font-medium">{terminal.cliCommand}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  terminal.status === 'running'
                    ? 'bg-emerald-400'
                    : terminal.status === 'error'
                      ? 'bg-rose-400'
                      : 'bg-zinc-400'
                }`} />
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(terminal.id);
                  }}
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          
          <div className="flex items-center gap-1 flex-shrink-0 pl-2 border-l border-zinc-200 dark:border-zinc-800">
            {onSwitchToAgent && (
              <button
                type="button"
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                onClick={onSwitchToAgent}
                title={t('terminal.switchToAgent')}
              >
                <SparklesIcon className="w-3.5 h-3.5" />
              </button>
            )}
            {onToggleLayout && (
              <button
                type="button"
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                onClick={onToggleLayout}
                title={orientation === 'vertical' ? t('terminal.dockToBottom') : t('terminal.dockToSide')}
              >
                {orientation === 'vertical' ? (
                  <ChevronDownIcon className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              type="button"
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
              onClick={() => {
                setSelectedPreset('codex');
                setCustomCommand('');
                setCreateError('');
                setShowCreate(true);
              }}
              title={t('terminal.newTerminal')}
            >
              <PlusIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 relative bg-white dark:bg-zinc-950 min-h-0">
          <style>{getScrollbarStyle()}</style>
          {terminals.length === 0 && renderEmpty()}
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={`absolute inset-0 bg-white dark:bg-zinc-950 pl-3 pr-0 py-2 ${activeId === terminal.id ? '' : 'hidden'}`}
            >
              <div ref={attachTerminal(terminal.id)} className="h-full w-full" />
            </div>
          ))}
          {terminals.length > 0 && !activeTerminal && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 bg-gray-50 dark:bg-zinc-900">
              {t('terminal.selectTerminal')}
            </div>
          )}
        </div>
      </aside>

      {showCreate && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-[420px] bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-700 overflow-hidden transition-colors">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-800/50 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
              {t('terminal.newTerminal')}
            </div>
            <div className="px-4 py-4 space-y-3">
              <div className="text-sm text-gray-600 dark:text-zinc-400">{t('terminal.selectCli')}</div>
              <div className="grid grid-cols-2 gap-2">
                {CLI_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPreset(preset.id)}
                    className={`px-3 py-2 rounded border text-sm text-left transition-colors ${
                      selectedPreset === preset.id
                        ? 'border-black bg-black text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600'
                    }`}
                  >
                    {preset.labelKey ? t(preset.labelKey) : preset.label}
                  </button>
                ))}
              </div>
              {selectedPreset === 'custom' && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-1">
                    {t('terminal.cliCommand')}
                  </label>
                  <input
                    type="text"
                    value={customCommand}
                    onChange={(event) => setCustomCommand(event.target.value)}
                    placeholder={t('terminal.commandPlaceholder')}
                    className="w-full rounded border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-zinc-500"
                  />
                </div>
              )}
              {createError && <div className="text-xs text-rose-500">{createError}</div>}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end gap-2 bg-gray-50/30 dark:bg-zinc-900/30">
              <button
                type="button"
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                onClick={() => setShowCreate(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm text-white bg-black rounded hover:bg-gray-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                onClick={handleCreate}
              >
                {t('terminal.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
