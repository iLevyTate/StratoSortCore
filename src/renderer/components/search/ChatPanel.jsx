import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Send, RefreshCw, FileText } from 'lucide-react';
import { Button, Textarea, Switch } from '../ui';

function normalizeImageSource(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:')) {
    return trimmed;
  }
  if (lower.startsWith('file://')) {
    return trimmed;
  }
  const normalized = trimmed.replace(/\\/g, '/');
  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${normalized}`;
  }
  return trimmed;
}

function formatLocation(source = {}) {
  const parts = [];
  const page = source.page || source.pageNumber;
  const line = source.line || source.lineNumber;
  const offset = source.offset || source.charOffset;
  const section = source.section || source.heading;
  if (page) parts.push(`Page ${page}`);
  if (section) parts.push(`Section ${section}`);
  if (line) parts.push(`Line ${line}`);
  if (offset) parts.push(`Offset ${offset}`);
  return parts.join(' • ');
}

function buildAssistantText(message) {
  if (!message || message.role !== 'assistant') return '';
  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return message.text.trim();
  }
  const docText = (message.documentAnswer || [])
    .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
    .filter(Boolean);
  const modelText = (message.modelAnswer || [])
    .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
    .filter(Boolean);
  return [...docText, ...modelText].join('\n\n');
}

function ThinkingDots() {
  return (
    <span className="thinking-dots" aria-hidden="true">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </span>
  );
}

function ChatModeToggle({ value, onChange }) {
  const isFast = value === 'fast';
  return (
    <div className="flex items-center gap-1 rounded-full bg-system-gray-100 p-1 text-[11px]">
      <button
        type="button"
        className={`chat-mode-toggle ${isFast ? 'chat-mode-toggle-active' : ''}`}
        onClick={() => onChange('fast')}
      >
        Fast
      </button>
      <button
        type="button"
        className={`chat-mode-toggle ${!isFast ? 'chat-mode-toggle-active' : ''}`}
        onClick={() => onChange('deep')}
      >
        Deep
      </button>
    </div>
  );
}

function SourceList({ sources, onOpenSource }) {
  if (!sources || sources.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-system-gray-200 bg-white px-3 py-3 text-xs text-system-gray-500">
        No sources found for this response.
      </div>
    );
  }

  const normalizeList = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  };

  return (
    <div className="mt-3 rounded-lg border border-system-gray-200 bg-white">
      <div className="px-3 py-2 text-xs font-semibold text-system-gray-500 uppercase tracking-wide">
        Sources
      </div>
      <div className="divide-y divide-system-gray-100">
        {sources.map((source) => {
          const tags = normalizeList(source.tags).slice(0, 3);
          const entities = normalizeList(source.entities).slice(0, 3);
          const dates = normalizeList(source.dates).slice(0, 2);
          const matchSources = normalizeList(source.matchDetails?.sources).slice(0, 3);
          const score =
            typeof source.score === 'number' ? `${Math.round(source.score * 100)}%` : '';
          const location = formatLocation(source);
          const imageSrc = normalizeImageSource(
            source.previewImage || source.imagePath || source.thumbnail || source.image
          );

          return (
            <div key={source.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <div className="mt-0.5 text-xs font-semibold text-system-gray-400">{source.id}</div>
              <div className="flex-1">
                <div className="font-medium text-system-gray-800">
                  {source.name || source.fileId}
                </div>
                {location ? (
                  <div className="text-[11px] text-system-gray-500 mt-0.5">{location}</div>
                ) : null}
                {source.snippet ? (
                  <div className="text-xs text-system-gray-500 mt-1 line-clamp-3">
                    {source.snippet}
                  </div>
                ) : null}
                {imageSrc ? (
                  <div className="mt-2">
                    <img
                      src={imageSrc}
                      alt=""
                      className="h-20 w-20 rounded-md object-cover border border-system-gray-200"
                      loading="lazy"
                    />
                  </div>
                ) : null}
                {tags.length > 0 ? (
                  <div className="mt-2 text-[11px] text-system-gray-500">
                    Tags: {tags.join(', ')}
                  </div>
                ) : null}
                {entities.length > 0 ? (
                  <div className="mt-1 text-[11px] text-system-gray-500">
                    Entities: {entities.join(', ')}
                  </div>
                ) : null}
                {dates.length > 0 ? (
                  <div className="mt-1 text-[11px] text-system-gray-500">
                    Dates: {dates.join(', ')}
                  </div>
                ) : null}
                {(matchSources.length > 0 || score) && (
                  <div className="mt-1 text-[11px] text-system-gray-500">
                    Why: {matchSources.length > 0 ? matchSources.join(' + ') : 'matched'}{' '}
                    {score ? `(${score})` : ''}
                  </div>
                )}
              </div>
              {source.path ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenSource(source)}
                  title="Open source file"
                >
                  <FileText className="w-4 h-4" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

SourceList.propTypes = {
  sources: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      fileId: PropTypes.string,
      name: PropTypes.string,
      path: PropTypes.string,
      snippet: PropTypes.string
    })
  ),
  onOpenSource: PropTypes.func.isRequired
};

function AnswerBlock({ title, items, showTitle, sources, onOpenSource }) {
  if (!items || items.length === 0) {
    return null;
  }

  const sourceById = new Map(
    (sources || []).map((source) => [source.id, source]).filter((pair) => pair[0])
  );

  return (
    <div className="space-y-2">
      {showTitle ? (
        <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wide">
          {title}
        </div>
      ) : null}
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={`${title}-${idx}`} className="text-sm text-system-gray-800">
            <div>{item.text}</div>
            {item.citations && item.citations.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-system-gray-500">
                {item.citations.map((citation) => {
                  const source = sourceById.get(citation);
                  const label = source?.name ? `${citation} · ${source.name}` : citation;
                  const canOpen = typeof onOpenSource === 'function' && source?.path;

                  return (
                    <button
                      key={citation}
                      type="button"
                      className="rounded bg-system-gray-100 px-1.5 py-0.5 text-left"
                      onClick={() => {
                        if (canOpen) onOpenSource(source);
                      }}
                      title={source?.path || citation}
                      disabled={!canOpen}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

AnswerBlock.propTypes = {
  title: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(
    PropTypes.shape({
      text: PropTypes.string.isRequired,
      citations: PropTypes.arrayOf(PropTypes.string)
    })
  ),
  showTitle: PropTypes.bool,
  sources: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      path: PropTypes.string
    })
  ),
  onOpenSource: PropTypes.func
};

AnswerBlock.defaultProps = {
  showTitle: true,
  sources: [],
  onOpenSource: null
};

ChatModeToggle.propTypes = {
  value: PropTypes.oneOf(['fast', 'deep']).isRequired,
  onChange: PropTypes.func.isRequired
};

export default function ChatPanel({
  messages,
  onSend,
  onReset,
  isSending,
  error,
  useSearchContext,
  onToggleSearchContext,
  onOpenSource,
  onUseSourcesInGraph,
  isSearching,
  isLoadingStats,
  responseMode,
  onResponseModeChange
}) {
  const [input, setInput] = useState('');
  const showSearchStatus = useSearchContext && (isSearching || isLoadingStats);

  const latestSources = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return lastAssistant?.sources || [];
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    await onSend(trimmed);
  };

  return (
    <div className="flex h-full flex-col chat-panel">
      <div className="flex items-center justify-between gap-3 border-b border-system-gray-200 px-4 py-3">
        <div className="text-sm font-semibold text-system-gray-800">Conversational Chat</div>
        <div className="flex items-center gap-2">
          {showSearchStatus && (
            <div className="inline-flex items-center gap-2 text-[11px] text-system-gray-500 bg-system-gray-100 px-2 py-1 rounded-full">
              <div className="h-2 w-2 rounded-full bg-system-gray-400 animate-pulse" />
              Updating search context...
            </div>
          )}
          {isSending && (
            <div className="inline-flex items-center gap-2 text-[11px] text-system-gray-500 bg-stratosort-blue/10 px-2 py-1 rounded-full">
              <div className="h-2 w-2 rounded-full bg-stratosort-blue animate-pulse" />
              Assistant thinking <ThinkingDots />
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-system-gray-500">
              Use search context
              <Switch checked={useSearchContext} onChange={onToggleSearchContext} />
            </div>
            <ChatModeToggle value={responseMode} onChange={onResponseModeChange} />
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} title="Reset chat">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 chat-thread">
        {messages.length === 0 ? (
          <div className="text-sm text-system-gray-500">
            Ask about your documents. Responses will separate document evidence from model
            knowledge.
          </div>
        ) : null}

        {messages.map((message, idx) => {
          const isUser = message.role === 'user';
          const assistantText = buildAssistantText(message);
          const hasDocumentAnswer =
            Array.isArray(message.documentAnswer) && message.documentAnswer.length > 0;
          const hasModelAnswer =
            Array.isArray(message.modelAnswer) && message.modelAnswer.length > 0;
          const hasSources = Array.isArray(message.sources) && message.sources.length > 0;

          return (
            <div
              key={`${message.role}-${idx}`}
              className={`chat-message ${isUser ? 'chat-message-user' : 'chat-message-assistant'}`}
            >
              <div className="chat-message-meta">
                <div className="chat-message-label">{isUser ? 'You' : 'Assistant'}</div>
              </div>
              <div
                className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}
              >
                {isUser ? (
                  <div className="chat-message-text whitespace-pre-wrap">{message.text}</div>
                ) : (
                  <div className="space-y-3">
                    <div className="chat-message-text whitespace-pre-wrap">
                      {assistantText ||
                        (isSending
                          ? 'Thinking...'
                          : 'I could not find an answer in the selected documents.')}
                    </div>
                    {(hasDocumentAnswer || hasModelAnswer) && (
                      <div className="space-y-2">
                        {hasDocumentAnswer ? (
                          <details className="chat-details">
                            <summary>
                              Evidence from documents ({message.documentAnswer.length})
                            </summary>
                            <div className="chat-details-body">
                              <AnswerBlock
                                title="Evidence"
                                items={message.documentAnswer}
                                showTitle={false}
                                sources={message.sources}
                                onOpenSource={onOpenSource}
                              />
                            </div>
                          </details>
                        ) : null}
                        {hasModelAnswer ? (
                          <details className="chat-details">
                            <summary>Model knowledge ({message.modelAnswer.length})</summary>
                            <div className="chat-details-body">
                              <AnswerBlock
                                title="Model"
                                items={message.modelAnswer}
                                showTitle={false}
                                sources={message.sources}
                                onOpenSource={onOpenSource}
                              />
                            </div>
                          </details>
                        ) : null}
                      </div>
                    )}
                    {Array.isArray(message.followUps) && message.followUps.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wide">
                          Suggested follow-ups
                        </div>
                        <div className="chat-followups">
                          {message.followUps.map((followUp) => (
                            <Button
                              key={followUp}
                              variant="secondary"
                              size="sm"
                              onClick={() => onSend(followUp)}
                            >
                              {followUp}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {hasSources ? (
                      <details className="chat-details">
                        <summary>Sources ({message.sources.length})</summary>
                        <div className="chat-details-body">
                          <SourceList sources={message.sources} onOpenSource={onOpenSource} />
                        </div>
                      </details>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {isSending && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-message-meta">
              <div className="chat-message-label">Assistant</div>
            </div>
            <div className="chat-bubble chat-bubble-assistant">
              <div className="chat-message-text text-system-gray-500">
                Assistant is thinking <ThinkingDots />
              </div>
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="px-4 py-2 bg-red-50 border-t border-b border-red-100 text-sm text-red-600 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="border-t border-system-gray-200 px-4 py-3 chat-input">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask a question about your documents..."
          rows={3}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-system-gray-500">
            Ctrl/⌘ + Enter to send
            {latestSources.length > 1 ? (
              <Button variant="ghost" size="sm" onClick={() => onUseSourcesInGraph(latestSources)}>
                View in graph
              </Button>
            ) : null}
          </div>
          <Button onClick={handleSend} disabled={isSending || !input.trim()}>
            <Send className="w-4 h-4" />
            <span>Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

ChatPanel.propTypes = {
  messages: PropTypes.arrayOf(
    PropTypes.shape({
      role: PropTypes.oneOf(['user', 'assistant']).isRequired,
      text: PropTypes.string,
      documentAnswer: PropTypes.array,
      modelAnswer: PropTypes.array,
      followUps: PropTypes.array,
      sources: PropTypes.array
    })
  ).isRequired,
  onSend: PropTypes.func.isRequired,
  onReset: PropTypes.func.isRequired,
  isSending: PropTypes.bool.isRequired,
  error: PropTypes.string,
  useSearchContext: PropTypes.bool.isRequired,
  onToggleSearchContext: PropTypes.func.isRequired,
  onOpenSource: PropTypes.func.isRequired,
  onUseSourcesInGraph: PropTypes.func.isRequired,
  isSearching: PropTypes.bool,
  isLoadingStats: PropTypes.bool,
  responseMode: PropTypes.oneOf(['fast', 'deep']),
  onResponseModeChange: PropTypes.func
};

ChatPanel.defaultProps = {
  error: '',
  responseMode: 'fast',
  onResponseModeChange: () => {}
};
