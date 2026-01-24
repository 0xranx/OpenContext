import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../../api';

export const useAgentStreaming = ({
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
  intentPrompts,
  statusLabelKeys,
  createMessage,
  setDialog,
  isComposing,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSessionId, setGeneratingSessionId] = useState(null);
  const [reasoningText, setReasoningText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const activeRequestIdRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const toolMessageMapRef = useRef(new Map());
  const activeToolAnchorRef = useRef(null);
  const activeThoughtMessageRef = useRef(null);
  const activeAssistantMessageRef = useRef(null);
  const toolSplitRef = useRef(new Set());
  const handledPermissionRef = useRef(new Set());
  const thoughtStartRef = useRef(0);

  const isThoughtRunning = Boolean(
    isGenerating && activeSession && generatingSessionId === activeSession.id,
  );

  useEffect(() => {
    if (!isThoughtRunning) {
      setElapsedSeconds(0);
      return undefined;
    }
    thoughtStartRef.current = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - thoughtStartRef.current) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [isThoughtRunning]);

  const ensureToolMessage = useCallback(
    (sessionId, callId, header, kind = 'tool', insertAfterId, anchorId) => {
      const key = `${sessionId}:${callId}`;
      const existingId = toolMessageMapRef.current.get(key);
      if (existingId) return existingId;
      const message = createMessage({ role: 'tool', kind, content: header || '', anchorId });
      if (insertAfterId) {
        insertMessageAfter(sessionId, insertAfterId, message);
      } else {
        appendMessages(sessionId, [message]);
      }
      toolMessageMapRef.current.set(key, message.id);
      return message.id;
    },
    [appendMessages, createMessage, insertMessageAfter],
  );

  const appendToolLikeMessage = useCallback(
    (sessionId, callId, text, kind = 'tool', insertAfterId) => {
      const key = `${sessionId}:${callId}`;
      const existed = toolMessageMapRef.current.has(key);
      let anchorAfterId = insertAfterId;
      const anchor = activeToolAnchorRef.current;
      let anchorMessageId = null;
      if (
        !anchorAfterId &&
        anchor &&
        anchor.sessionId === sessionId &&
        anchor.requestId === activeRequestIdRef.current
      ) {
        anchorAfterId = anchor.lastToolId || anchor.assistantMessageId;
        anchorMessageId = anchor.assistantMessageId;
      }
      const messageId = ensureToolMessage(
        sessionId,
        callId,
        '',
        kind,
        anchorAfterId,
        anchorMessageId || insertAfterId,
      );
      if (!existed && anchor && anchor.sessionId === sessionId && anchor.requestId === activeRequestIdRef.current) {
        anchor.lastToolId = messageId;
      }
      updateMessageContent(sessionId, messageId, (prev) => {
        const base = prev || '';
        if (!base) return text;
        if (!text) return base;
        return `${base}\n${text}`;
      });
      return messageId;
    },
    [ensureToolMessage, updateMessageContent],
  );

  const updateToolSummary = useCallback(
    (sessionId, callId, summary, kind = 'tool') => {
      const messageId = ensureToolMessage(sessionId, callId, '', kind);
      updateMessageSummary(sessionId, messageId, summary);
    },
    [ensureToolMessage, updateMessageSummary],
  );

  const runOcCommand = useCallback(
    async (sessionId, args, kind = 'tool', callIdOverride, insertAfterId) => {
      if (!args || !args.length) return null;
      const callId = callIdOverride || `oc-${Date.now()}`;
      const appendMessage = (text) =>
        appendToolLikeMessage(sessionId, callId, text, kind, insertAfterId);
      appendMessage(`$ oc ${args.join(' ')}`);
      try {
        const result = await api.execOcCommand({ args });
        const stdout = result?.stdout || '';
        const stderr = result?.stderr || '';
        const code = result?.code;
        if (stdout) appendMessage(stdout);
        if (stderr) appendMessage(stderr);
        if (code !== undefined) appendMessage(`exit: ${code}`);
        return { stdout, stderr, code };
      } catch (error) {
        appendMessage(String(error?.message || error || 'oc command failed'));
        return { stdout: '', stderr: String(error?.message || error || 'oc command failed'), code: -1 };
      }
    },
    [appendToolLikeMessage],
  );

  const splitAssistantForTool = useCallback(
    (sessionId, callId, kind = 'tool') => {
      const anchor = activeToolAnchorRef.current;
      if (!anchor || anchor.sessionId !== sessionId || anchor.requestId !== activeRequestIdRef.current) {
        return null;
      }
      const currentAssistantId = activeAssistantMessageRef.current || anchor.assistantMessageId;
      if (!currentAssistantId) return null;
      if (toolSplitRef.current?.has(callId)) return currentAssistantId;

      const thoughtRef = activeThoughtMessageRef.current;
      if (thoughtRef?.messageId && thoughtRef.sessionId === sessionId) {
        setExpandedThoughtMessages((prev) => {
          const next = new Set(prev);
          next.delete(thoughtRef.messageId);
          return next;
        });
      }

      const toolMessageId = ensureToolMessage(
        sessionId,
        callId,
        '',
        kind,
        currentAssistantId,
        currentAssistantId,
      );
      toolSplitRef.current?.add(callId);

      const continuation = createMessage({ role: 'assistant', kind: 'text', content: '' });
      insertMessageAfter(sessionId, toolMessageId, continuation);
      activeAssistantMessageRef.current = continuation.id;
      anchor.assistantMessageId = continuation.id;
      anchor.lastToolId = toolMessageId;
      return continuation.id;
    },
    [createMessage, ensureToolMessage, insertMessageAfter, setExpandedThoughtMessages],
  );

  const handleSend = useCallback(async () => {
    const trimmed = sanitizeText(inputValue);
    if (!trimmed || !activeSession || !isInputReady || isGenerating) return;
    const sessionId = activeSession.id;
    const resolvedIntent = activeSession.intent || resolveIntentFromText(trimmed);
    if (activeSession.autoTitle && activeSession.messages.length === 0) {
      const derived = deriveSessionTitle(trimmed);
      if (derived) {
        updateSession(sessionId, { name: derived, autoTitle: false });
      } else {
        updateSession(sessionId, { autoTitle: false });
      }
    }
    const userMessage = createMessage({ role: 'user', kind: 'text', content: trimmed });
    const assistantMessage = createMessage({ role: 'assistant', kind: 'text', content: '' });
    appendMessages(sessionId, [userMessage, assistantMessage]);
    setInputValue('');
    setIsGenerating(true);
    setGeneratingSessionId(sessionId);
    setReasoningText('');
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = requestId;
    activeToolAnchorRef.current = {
      requestId,
      sessionId,
      assistantMessageId: assistantMessage.id,
      lastToolId: null,
    };
    activeAssistantMessageRef.current = assistantMessage.id;
    toolSplitRef.current = new Set();
    activeThoughtMessageRef.current = {
      requestId,
      sessionId,
      messageId: null,
      anchorId: userMessage.id,
    };
    stopRequestedRef.current = false;
    if (activeSession.intent) {
      updateSession(sessionId, { intent: null });
    }

    const intentPrompt = resolvedIntent ? intentPrompts[resolvedIntent] : '';
    const extraSystem = [contextBlock, intentPrompt].filter(Boolean).join('\n\n');
    const messagesForModel = buildModelMessages(
      activeSession,
      [...activeSession.messages, userMessage],
      extraSystem,
    );
    let streamError = null;
    let assistantText = '';

    try {
      const modelOverride = sanitizeText(activeSession.model);
      const agentId = activeSession.agentId;
      const isCodex = agentId === 'codex';
      const isClaude = agentId === 'claude';
      const isOpenCode = agentId === 'opencode';
      const streamFn = isCodex
        ? api.streamCodexExec
        : isClaude
          ? api.streamClaudeExec
          : isOpenCode
            ? api.streamOpenCodeRun
            : api.streamAIChat;
      const streamOptions =
        isCodex || isClaude || isOpenCode
          ? {
              sessionId,
              requestId,
              ...(modelOverride ? { model: modelOverride } : {}),
            }
          : modelOverride
            ? { model: modelOverride }
            : undefined;

      await streamFn(
        messagesForModel,
        (token) => {
          if (stopRequestedRef.current) return;
          if (activeRequestIdRef.current !== requestId) return;
          assistantText += token || '';
          const targetId = activeAssistantMessageRef.current || assistantMessage.id;
          updateMessageContent(sessionId, targetId, (prev) => `${prev || ''}${token}`);
        },
        (error) => {
          streamError = error;
        },
        {
          ...streamOptions,
          onStatus: (status) => {
            if (activeRequestIdRef.current !== requestId) return;
            if (status && statusLabelKeys[status]) {
              updateSession(sessionId, { status });
            }
            if (status === 'task_started') {
              setIsGenerating(true);
              setGeneratingSessionId(sessionId);
            }
            if (status === 'stopped') {
              setIsGenerating(false);
              setGeneratingSessionId(null);
              setReasoningText('');
            }
          },
          onReasoning: (delta) => {
            if (activeRequestIdRef.current !== requestId) return;
            setReasoningText((prev) => `${prev || ''}${delta}`);
            const thoughtRef = activeThoughtMessageRef.current;
            if (!thoughtRef || thoughtRef.requestId !== requestId || thoughtRef.sessionId !== sessionId) {
              return;
            }
            if (!thoughtRef.messageId) {
              const thoughtMessage = createMessage({ role: 'assistant', kind: 'thought', content: '' });
              insertMessageAfter(sessionId, thoughtRef.anchorId, thoughtMessage);
              thoughtRef.messageId = thoughtMessage.id;
              setExpandedThoughtMessages((prev) => {
                const next = new Set(prev);
                next.add(thoughtMessage.id);
                return next;
              });
            }
            updateMessageContent(sessionId, thoughtRef.messageId, (prev) => `${prev || ''}${delta}`);
          },
          onPermission: (permission) => {
            if (activeRequestIdRef.current !== requestId) return;
            if (!permission?.callId) return;
            const permissionKey = `${sessionId}:${permission.callId}`;
            if (handledPermissionRef.current.has(permissionKey)) return;
            handledPermissionRef.current.add(permissionKey);
            splitAssistantForTool(sessionId, permission.callId, 'tool');

            if (permission.source === 'acp') {
              const toolCall = permission.toolCall || {};
              const rawInput = toolCall.rawInput || {};
              const options = Array.isArray(permission.options) ? permission.options : [];
              const allowOption =
                options.find((option) => option.kind?.startsWith('allow')) || options[0] || null;
              const denyOption =
                options.find((option) => option.kind?.startsWith('reject')) ||
                options[options.length - 1] ||
                null;
              const messageLines = [];
              const title = toolCall.title || toolCall.kind || '';
              if (title) messageLines.push(title);
              const command = Array.isArray(rawInput.command)
                ? rawInput.command.join(' ')
                : rawInput.command;
              if (command) {
                messageLines.push(t('agent.permissionCommand', { command }));
              }
              if (rawInput.diff || rawInput.patch) {
                messageLines.push(t('agent.permissionPatch'));
              }
              const filePath = rawInput.filePath || rawInput.filepath || rawInput.path;
              if (filePath) {
                messageLines.push(filePath);
              }
              const locations = Array.isArray(toolCall.locations) ? toolCall.locations : [];
              const locationPaths = locations
                .map((loc) => loc?.path)
                .filter(Boolean);
              if (!filePath && locationPaths.length) {
                messageLines.push(...locationPaths);
              }

              appendToolLikeMessage(
                sessionId,
                permission.callId,
                messageLines.filter(Boolean).join('\n'),
              );

              setDialog({
                isOpen: true,
                type: 'confirm',
                title: t('agent.permissionTitle'),
                message: messageLines.filter(Boolean).join('\n'),
                confirmText: allowOption?.name || t('agent.permissionAllow'),
                cancelText: denyOption?.name || t('agent.permissionDeny'),
                onConfirm: () =>
                  api.respondAcpPermission({
                    sessionId,
                    callId: permission.callId,
                    optionId: allowOption?.optionId,
                  }),
                onCancel: () =>
                  api.respondAcpPermission({
                    sessionId,
                    callId: permission.callId,
                    optionId: denyOption?.optionId,
                  }),
                isDestructive: true,
              });
              return;
            }

            const subtype = permission.type;
            const data = permission.data || {};
            const command = Array.isArray(data.command) ? data.command.join(' ') : data.command;
            const summary = data.summary || data.message || data.reason || '';
            const cwd = data.cwd || '';
            const title = t('agent.permissionTitle');
            const messageLines = [];
            if (subtype === 'exec_approval_request' && command) {
              messageLines.push(t('agent.permissionCommand', { command }));
            }
            if (subtype === 'apply_patch_approval_request') {
              messageLines.push(t('agent.permissionPatch'));
            }
            if (cwd) {
              messageLines.push(t('agent.permissionCwd', { cwd }));
            }
            if (summary) {
              messageLines.push(summary);
            }

            appendToolLikeMessage(
              sessionId,
              permission.callId,
              messageLines.filter(Boolean).join('\n'),
            );

            setDialog({
              isOpen: true,
              type: 'confirm',
              title,
              message: messageLines.filter(Boolean).join('\n'),
              confirmText: t('agent.permissionAllow'),
              cancelText: t('agent.permissionDeny'),
              onConfirm: () =>
                api.respondCodexPermission({
                  sessionId,
                  callId: permission.callId,
                  type: subtype,
                  approved: true,
                }),
              onCancel: () =>
                api.respondCodexPermission({
                  sessionId,
                  callId: permission.callId,
                  type: subtype,
                  approved: false,
                }),
              isDestructive: true,
            });
            return;
          },
          onTool: (toolEvent) => {
            if (activeRequestIdRef.current !== requestId) return;
            if (!toolEvent?.callId) return;
            const { type, data } = toolEvent;
            if (type === 'tool_call' || type === 'tool_call_update') {
              const update = data?.update || {};
              const title = update.title || update.kind || 'Tool';
              const status = update.status ? `status: ${update.status}` : '';
              if (type === 'tool_call') {
                splitAssistantForTool(sessionId, toolEvent.callId, 'tool');
                const locations = Array.isArray(update.locations)
                  ? update.locations.map((loc) => loc?.path).filter(Boolean)
                  : [];
                appendToolLikeMessage(
                  sessionId,
                  toolEvent.callId,
                  [title, status, ...locations].filter(Boolean).join('\n'),
                );
                return;
              }
              if (status) {
                appendToolLikeMessage(sessionId, toolEvent.callId, status);
              }
              const contentBlocks = Array.isArray(update.content) ? update.content : [];
              contentBlocks.forEach((block) => {
                if (block?.type === 'content' && block?.content?.type === 'text') {
                  appendToolLikeMessage(sessionId, toolEvent.callId, block.content.text || '');
                }
                if (block?.type === 'diff') {
                  const path = block.path ? `diff: ${block.path}` : 'diff';
                  appendToolLikeMessage(sessionId, toolEvent.callId, path);
                }
              });
              if (update?.rawOutput?.error) {
                appendToolLikeMessage(sessionId, toolEvent.callId, update.rawOutput.error);
              }
              return;
            }
            if (type === 'exec_command_begin') {
              splitAssistantForTool(sessionId, toolEvent.callId, 'tool');
              const command = Array.isArray(data.command) ? data.command.join(' ') : data.command;
              const header = command ? `> ${command}` : 'Running command';
              const cwd = data.cwd ? `cwd: ${data.cwd}` : '';
              appendToolLikeMessage(sessionId, toolEvent.callId, [header, cwd].filter(Boolean).join('\n'));
              return;
            }
            if (type === 'exec_command_output_delta') {
              const chunk = data.chunk || '';
              if (chunk) appendToolLikeMessage(sessionId, toolEvent.callId, chunk);
              return;
            }
            if (type === 'exec_command_end') {
              const exitCode = data.exit_code ?? data.exitCode;
              const footer = exitCode !== undefined ? `exit: ${exitCode}` : 'command finished';
              appendToolLikeMessage(sessionId, toolEvent.callId, footer);
              if (data.stderr) {
                appendToolLikeMessage(sessionId, toolEvent.callId, data.stderr);
              }
              return;
            }
            if (type === 'patch_apply_begin' || type === 'apply_patch_begin') {
              splitAssistantForTool(sessionId, toolEvent.callId, 'tool');
              updateToolSummary(sessionId, toolEvent.callId, t('agent.patchApplying'));
              appendToolLikeMessage(sessionId, toolEvent.callId, t('agent.patchApplying'));
              return;
            }
            if (type === 'patch_apply_end' || type === 'apply_patch_end') {
              const success = data.success;
              const status = success ? t('agent.patchApplied') : t('agent.patchFailed');
              updateToolSummary(sessionId, toolEvent.callId, status);
              appendToolLikeMessage(sessionId, toolEvent.callId, status);
              if (Array.isArray(data.appliedChanges) && data.appliedChanges.length) {
                appendToolLikeMessage(sessionId, toolEvent.callId, `applied: ${data.appliedChanges.join(', ')}`);
              }
              if (Array.isArray(data.failedChanges) && data.failedChanges.length) {
                appendToolLikeMessage(sessionId, toolEvent.callId, `failed: ${data.failedChanges.join(', ')}`);
              }
              if (data.error) {
                appendToolLikeMessage(sessionId, toolEvent.callId, data.error);
              }
              return;
            }
            if (type === 'mcp_tool_call_begin') {
              splitAssistantForTool(sessionId, toolEvent.callId, 'tool');
              const toolName = data.toolName || data.tool_name;
              const header = toolName ? `MCP: ${toolName}` : t('agent.mcpToolCall');
              appendToolLikeMessage(sessionId, toolEvent.callId, header);
              return;
            }
            if (type === 'mcp_tool_call_end') {
              const error = data.error ? `error: ${data.error}` : null;
              if (error) appendToolLikeMessage(sessionId, toolEvent.callId, error);
            }
          },
        },
      );
    } catch (error) {
      streamError = streamError || error;
    } finally {
      if (!streamError) {
        const { args } = extractOcAction(assistantText);
        const targetId = activeAssistantMessageRef.current || assistantMessage.id;
        updateMessageContent(sessionId, targetId, (prev) => {
          const { cleaned } = extractOcAction(prev || '');
          return cleaned;
        });
        if (args && args.length) {
          const ocCallId = `oc-${Date.now()}`;
          splitAssistantForTool(sessionId, ocCallId, 'tool');
          await runOcCommand(sessionId, args, 'tool', ocCallId);
        }
      }
      if (streamError) {
        appendMessages(sessionId, [
          createMessage({
            role: 'tool',
            kind: 'tool',
            content: t('agent.toolError', { message: streamError.message || String(streamError) }),
          }),
        ]);
        updateSession(sessionId, { status: 'error' });
      }
      if (activeRequestIdRef.current === requestId) {
        setIsGenerating(false);
        setGeneratingSessionId(null);
        setReasoningText('');
        activeRequestIdRef.current = null;
        if (activeToolAnchorRef.current?.requestId === requestId) {
          activeToolAnchorRef.current = null;
        }
        if (activeThoughtMessageRef.current?.requestId === requestId) {
          const thoughtId = activeThoughtMessageRef.current.messageId;
          if (thoughtId) {
            setExpandedThoughtMessages((prev) => {
              const next = new Set(prev);
              next.delete(thoughtId);
              return next;
            });
          }
          activeThoughtMessageRef.current = null;
        }
        toolSplitRef.current = new Set();
        activeAssistantMessageRef.current = null;
      }
    }
  }, [
    activeSession,
    appendMessages,
    buildModelMessages,
    contextBlock,
    createMessage,
    deriveSessionTitle,
    extractOcAction,
    inputValue,
    intentPrompts,
    isGenerating,
    isInputReady,
    resolveIntentFromText,
    runOcCommand,
    sanitizeText,
    setDialog,
    setExpandedThoughtMessages,
    setInputValue,
    splitAssistantForTool,
    statusLabelKeys,
    t,
    updateMessageContent,
    updateSession,
  ]);

  const handleStop = useCallback(() => {
    stopRequestedRef.current = true;
    if (activeRequestIdRef.current && activeSession?.id) {
      const sessionId = activeSession.id;
      if (activeSession?.agentId === 'codex') {
        api.stopCodexExec(sessionId).catch(() => {});
      } else if (activeSession?.agentId === 'claude') {
        api.stopClaudeExec(sessionId).catch(() => {});
      } else if (activeSession?.agentId === 'opencode') {
        api.stopOpenCodeRun(sessionId).catch(() => {});
      }
    }
    setIsGenerating(false);
    setGeneratingSessionId(null);
    setReasoningText('');
    activeRequestIdRef.current = null;
    if (activeSession?.id) {
      updateSession(activeSession.id, { status: 'disconnected' });
    }
  }, [activeSession, updateSession]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter') return;
      if (event.shiftKey) return;
      if (isComposing) return;
      if (isGenerating) return;
      event.preventDefault();
      if (!activeSession) return;
      void handleSend();
    },
    [activeSession, handleSend, isComposing, isGenerating],
  );

  return {
    isGenerating,
    generatingSessionId,
    reasoningText,
    elapsedSeconds,
    isThoughtRunning,
    activeThoughtMessageRef,
    handleSend,
    handleStop,
    handleKeyDown,
  };
};
