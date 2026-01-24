import { Fragment, useCallback, useMemo } from 'react';
import {
  ChevronDownIcon,
  ClipboardDocumentIcon,
  CommandLineIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  PencilSquareIcon,
  CubeTransparentIcon,
} from '@heroicons/react/24/outline';
import { TiptapMarkdownViewer } from '../TiptapMarkdown';
import { TOOL_STATUS_STYLES } from './constants';


const getToolCardMeta = (message) => {
  const content = message.content || '';
  const lines = content.split('\n');
  const firstLine = lines[0] || '';
  let toolLabel = 'Tool';
  let toolCommand = message.summary || firstLine;
  let toolType = 'generic'; // generic, shell, patch, mcp

  if (firstLine.startsWith('> ')) {
    toolLabel = 'Exec';
    toolCommand = firstLine.substring(2);
    toolType = 'shell';
  } else if (firstLine.startsWith('$ ')) {
    toolLabel = 'Shell';
    toolCommand = firstLine.substring(2);
    toolType = 'shell';
  } else if (firstLine.startsWith('MCP: ')) {
    toolLabel = 'MCP';
    toolCommand = firstLine.substring(5);
    toolType = 'mcp';
  } else if (firstLine.startsWith('diff: ')) {
    toolLabel = 'Diff';
    toolType = 'patch';
  }

  if (message.summary) {
    if (message.summary.includes('Patch') || message.summary.includes('修改')) {
      toolLabel = 'Patch';
      toolType = 'patch';
    }
    toolCommand = message.summary;
  }

  if (!toolCommand && content.length > 0) toolCommand = 'Output available';

  return { content, toolLabel, toolCommand, toolType };
};

const getToolStatus = (message, content) => {
  let status = 'neutral'; // neutral, success, error
  const lowerContent = content.toLowerCase();
  const lowerSummary = (message.summary || '').toLowerCase();

  if (lowerContent.includes('exit: 0') || lowerSummary.includes('applied') || lowerSummary.includes('成功')) {
    status = 'success';
  } else if (lowerContent.includes('exit: ') || lowerSummary.includes('failed') || lowerSummary.includes('error') || lowerSummary.includes('失败')) {
    status = lowerContent.includes('exit: 0') ? 'success' : 'error';
  }

  return status;
};

function ToolCard({ message, isExpanded, onToggle, onCopy, t }) {
  const { content, toolLabel, toolCommand, toolType } = getToolCardMeta(message);
  const status = getToolStatus(message, content);

  let Icon = CommandLineIcon;
  if (toolType === 'patch') Icon = PencilSquareIcon;
  if (toolType === 'mcp') Icon = CubeTransparentIcon;

  const statusStyle = TOOL_STATUS_STYLES[status] || TOOL_STATUS_STYLES.neutral;
  const borderClass = isExpanded ? statusStyle.border[1] : statusStyle.border[0];

  return (
    <div className="flex justify-start max-w-[780px] mx-auto px-3 mb-2 group">
      <div className="flex flex-col w-full">
        <div
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer select-none ${statusStyle.bg} ${borderClass}`}
          onClick={() => onToggle(message.id)}
        >
          <div className={`flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-md ${statusStyle.badge}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${statusStyle.label}`}>
                {toolLabel}
              </span>
              {status === 'success' && <CheckCircleIcon className="h-3 w-3 text-emerald-500" />}
              {status === 'error' && <ExclamationCircleIcon className="h-3 w-3 text-red-500" />}
            </div>
            <div className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate pr-2" title={toolCommand}>
              {toolCommand || 'View output'}
            </div>
          </div>

          <div className={`flex-shrink-0 transition-transform duration-200 text-zinc-400 ${isExpanded ? 'rotate-180' : ''}`}>
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </div>
        </div>

        {isExpanded && (
          <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800">
                <span className="text-[10px] font-medium text-zinc-400">FULL OUTPUT</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onCopy(content);
                  }}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title={t('codeBlock.copy')}
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-0 text-[11px] font-mono overflow-x-auto custom-scrollbar max-h-[400px] bg-white dark:bg-zinc-950">
                <TiptapMarkdownViewer
                  markdown={(() => {
                    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
                      try {
                        JSON.parse(content);
                        return '```json\n' + content + '\n```';
                      } catch (err) {}
                    }
                    return '```text\n' + content + '\n```';
                  })()}
                  editorId={`tool-out-${message.id}`}
                  className="!text-[11px] !font-mono prose-pre:!m-0 prose-pre:!bg-transparent prose-pre:!p-3 prose-pre:!rounded-none prose-pre:!border-0 prose-pre:!shadow-none prose-pre:!ring-0 prose-code:!bg-transparent prose-code:!text-zinc-600 dark:prose-code:!text-zinc-400 prose-code:!p-0 prose-code:!shadow-none prose-code:!border-0"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolList({ tools, expandedToolMessages, onToggle, onCopy, t }) {
  if (!tools || tools.length === 0) return null;
  return tools.map((toolMessage) => (
    <ToolCard
      key={toolMessage.id}
      message={toolMessage}
      isExpanded={expandedToolMessages.has(toolMessage.id)}
      onToggle={onToggle}
      onCopy={onCopy}
      t={t}
    />
  ));
}

function MessageBubble({ message, isUser, onCopy, t }) {
  const content = message.content || '';
  return (
    <div className={`relative flex ${isUser ? 'justify-end' : 'justify-start'} max-w-[780px] mx-auto px-3 mb-3 group`}>
      <div className={`relative flex flex-col ${isUser ? 'items-end max-w-[90%]' : 'items-start w-full'}`}>
        <div
          className={`relative text-sm ${
            isUser
              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 px-3 py-2 rounded-xl rounded-tr-sm'
              : 'text-zinc-900 dark:text-zinc-100 px-0 py-0.5 w-full'
          }`}
        >
          <TiptapMarkdownViewer
            markdown={content}
            editorId={`agent-msg-${message.id}`}
            className={
              isUser
                ? 'prose-sm prose-zinc dark:prose-invert w-full max-w-full break-words prose-p:my-0 prose-pre:my-2 prose-pre:bg-zinc-200 dark:prose-pre:bg-zinc-900 leading-[1.4] text-[13px] prose-pre:whitespace-pre-wrap prose-pre:break-words [&_code]:!whitespace-pre-wrap [&_code]:!break-all [&_a]:!break-all'
                : 'prose-sm prose-zinc dark:prose-invert w-full max-w-full break-words prose-p:my-1 prose-pre:my-2 leading-[1.4] text-[13px] prose-pre:whitespace-pre-wrap prose-pre:break-words [&_code]:!whitespace-pre-wrap [&_code]:!break-all [&_a]:!break-all'
            }
          />
        </div>

        {!isUser && content.trim() && (
          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              type="button"
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors px-1 py-0.5 rounded cursor-pointer"
              onClick={() => onCopy(content)}
              title={t('codeBlock.copy')}
            >
              <ClipboardDocumentIcon className="h-3 w-3" />
              <span>{t('codeBlock.copy')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ThoughtMessage({ message, isExpanded, isActiveThought, thoughtPreview, onToggle, t }) {
  return (
    <div className="flex justify-start max-w-[780px] mx-auto px-3 mb-2">
      <div className="flex flex-col w-full">
        <div
          className="flex items-center gap-2 py-1.5 cursor-pointer select-none group opacity-80 hover:opacity-100 transition-opacity"
          onClick={() => onToggle(message.id)}
        >
          <div className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronDownIcon className="h-3 w-3 -rotate-90" />
          </div>

          {isActiveThought ? (
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-pulse" />
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {t('agent.thoughtTitleRunning')}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 overflow-hidden w-full">
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors whitespace-nowrap flex-shrink-0">
                {t('agent.thoughtTitle')}
              </span>
              {thoughtPreview && (
                <span className="text-[11px] text-zinc-300 dark:text-zinc-600 truncate font-normal select-none min-w-0">
                  {thoughtPreview}
                </span>
              )}
            </div>
          )}
        </div>

        {isExpanded && (
          <div className="pl-2 ml-1.5 border-l-2 border-zinc-200 dark:border-zinc-800 my-1 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="pl-3 py-1">
              <TiptapMarkdownViewer
                markdown={message.content || ''}
                editorId={`agent-thought-${message.id}`}
                className="prose-sm prose-zinc dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 text-[12px] font-mono text-zinc-600 dark:text-zinc-400"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentMessageList({
  activeSession,
  isGenerating,
  expandedToolMessages,
  expandedThoughtMessages,
  onToggleTool,
  onToggleThought,
  onCopy,
  t,
  activeThoughtMessageRef,
}) {
  const toolMessagesByAnchor = useMemo(() => {
    if (!activeSession) return new Map();
    const map = new Map();
    activeSession.messages.forEach((message) => {
      if ((message.kind === 'tool' || message.kind === 'oc') && message.anchorId) {
        const list = map.get(message.anchorId) || [];
        list.push(message);
        map.set(message.anchorId, list);
      }
    });
    return map;
  }, [activeSession?.messages]);

  const renderMessageItem = useCallback(
    (message) => {
      const isUser = message.role === 'user';
      const isTool = message.kind === 'tool' || message.kind === 'oc';
      const isAnchoredTool = isTool && message.anchorId;
      const anchoredTools = toolMessagesByAnchor.get(message.id) || [];
      const hasContent = Boolean(message.content?.trim());

      if (!isTool && message.kind !== 'thought' && !hasContent && anchoredTools.length === 0) return null;
      if (isAnchoredTool) return null;

      if (message.kind === 'thought') {
        const isActiveThought =
          activeThoughtMessageRef.current?.messageId === message.id && isGenerating;
        const isExpanded = expandedThoughtMessages.has(message.id);
        const thoughtPreview = !isExpanded && message.content
          ? (() => {
              const cleaned = (message.content || '').replace(/[#*`]/g, '');
              return cleaned.slice(0, 60).trim() + (cleaned.length > 60 ? '...' : '');
            })()
          : '';

        return (
          <ThoughtMessage
            key={message.id}
            message={message}
            isExpanded={isExpanded}
            isActiveThought={isActiveThought}
            thoughtPreview={thoughtPreview}
            onToggle={onToggleThought}
            t={t}
          />
        );
      }

      if (isTool) {
        return (
          <Fragment key={message.id}>
            <ToolCard
              message={message}
              isExpanded={expandedToolMessages.has(message.id)}
              onToggle={onToggleTool}
              onCopy={onCopy}
              t={t}
            />
            <ToolList
              tools={anchoredTools}
              expandedToolMessages={expandedToolMessages}
              onToggle={onToggleTool}
              onCopy={onCopy}
              t={t}
            />
          </Fragment>
        );
      }

      if (!isUser && !hasContent && anchoredTools.length > 0) {
        return (
          <Fragment key={message.id}>
            <ToolList
              tools={anchoredTools}
              expandedToolMessages={expandedToolMessages}
              onToggle={onToggleTool}
              onCopy={onCopy}
              t={t}
            />
          </Fragment>
        );
      }

      return (
        <Fragment key={message.id}>
          <MessageBubble message={message} isUser={isUser} onCopy={onCopy} t={t} />
          <ToolList
            tools={anchoredTools}
            expandedToolMessages={expandedToolMessages}
            onToggle={onToggleTool}
            onCopy={onCopy}
            t={t}
          />
        </Fragment>
      );
    },
    [
      expandedToolMessages,
      expandedThoughtMessages,
      isGenerating,
      onCopy,
      onToggleThought,
      onToggleTool,
      t,
      toolMessagesByAnchor,
      activeThoughtMessageRef,
    ],
  );

  if (!activeSession) return null;
  return activeSession.messages.map(renderMessageItem);
}
