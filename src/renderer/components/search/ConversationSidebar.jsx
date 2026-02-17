import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Plus, MessageSquare, Trash2, Search } from 'lucide-react';
import { Button } from '../ui';
import { Text } from '../ui/Typography';
import {
  listConversations,
  deleteConversation,
  searchConversations
} from '../../services/ipc/chatIpc';
import { createLogger } from '../../../shared/logger';

const logger = createLogger('ConversationSidebar');

function ConversationItem({ conversation, isSelected, onSelect, onDelete, isPendingDelete }) {
  const date = new Date(conversation.updatedAt || conversation.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div
      className={`group flex items-center justify-between p-2 rounded-md cursor-pointer mb-1 transition-colors ${
        isSelected
          ? 'bg-stratosort-blue/10 text-stratosort-blue-dark'
          : 'hover:bg-system-gray-100 text-system-gray-700'
      }`}
      onClick={() => onSelect(conversation.id)}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <MessageSquare
          className={`w-4 h-4 shrink-0 ${isSelected ? 'text-stratosort-blue' : 'text-system-gray-400'}`}
        />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">
            {conversation.title || 'New Conversation'}
          </span>
          <span className="text-[10px] text-system-gray-400">{dateStr}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={`p-1 h-auto transition-all ${
          isPendingDelete
            ? 'opacity-100 text-red-600 bg-red-50'
            : `opacity-0 group-hover:opacity-100 text-system-gray-400 hover:text-red-500 hover:bg-red-50 ${isSelected ? 'opacity-100' : ''}`
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(conversation.id);
        }}
        title={isPendingDelete ? 'Click again to confirm' : 'Delete conversation'}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

ConversationItem.propTypes = {
  conversation: PropTypes.object.isRequired,
  isSelected: PropTypes.bool,
  isPendingDelete: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired
};

export default function ConversationSidebar({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  className = ''
}) {
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      let results;
      if (debouncedQuery.trim()) {
        results = await searchConversations(debouncedQuery);
      } else {
        results = await listConversations(50, 0);
      }
      setConversations(results);
    } catch (err) {
      logger.warn('[ConversationSidebar] Failed to load conversations', {
        error: err?.message || String(err)
      });
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations, currentConversationId]); // Reload when current ID changes (e.g. after new chat)

  const handleDelete = async (id) => {
    if (pendingDeleteId === id) {
      // Second click confirms deletion
      setPendingDeleteId(null);
      try {
        await deleteConversation(id);
        if (id === currentConversationId) {
          onNewConversation();
        }
        loadConversations();
      } catch (err) {
        logger.warn('[ConversationSidebar] Failed to delete conversation', {
          id,
          error: err?.message || String(err)
        });
      }
    } else {
      // First click arms the deletion (click again to confirm)
      setPendingDeleteId(id);
      // Auto-cancel after 3 seconds
      setTimeout(() => setPendingDeleteId((prev) => (prev === id ? null : prev)), 3000);
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-system-gray-50 border-r border-system-gray-200 ${className}`}
    >
      <div className="p-3 border-b border-system-gray-200 space-y-3">
        <Button
          variant="primary"
          className="w-full justify-center gap-2"
          onClick={onNewConversation}
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </Button>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-system-gray-400" />
          <input
            type="text"
            placeholder="Search chats..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-system-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-stratosort-blue focus:border-stratosort-blue"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && conversations.length === 0 ? (
          <div className="flex justify-center py-4 animate-loading-fade">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-stratosort-blue animate-loading-content"></div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8 text-system-gray-400">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <Text variant="tiny">No conversations yet</Text>
          </div>
        ) : (
          <>
            <div className="mb-2 px-2">
              <Text
                variant="tiny"
                className="font-semibold text-system-gray-500 uppercase tracking-wide"
              >
                Recent
              </Text>
            </div>
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={conv.id === currentConversationId}
                isPendingDelete={conv.id === pendingDeleteId}
                onSelect={onSelectConversation}
                onDelete={handleDelete}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

ConversationSidebar.propTypes = {
  currentConversationId: PropTypes.string,
  onSelectConversation: PropTypes.func.isRequired,
  onNewConversation: PropTypes.func.isRequired,
  className: PropTypes.string
};
