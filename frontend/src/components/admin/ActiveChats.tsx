import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, User, Bot, Send } from 'lucide-react';
import { User as AppUser } from '../../App';
import { apiCall } from '../../utils/api';
import { useWebSocket } from '../../hooks/useWebSocket';

interface ChatSession {
  id: string;
  customer_id: string;
  customer_name: string;
  category: string;
  last_message: string;
  timestamp: string | null;
  status: 'ai' | 'agent';
  unread: number;
}

type ApiMessage = {
  id: string;
  sender_type: 'user' | 'ai' | 'agent';
  content: string;
  created_at?: string;
};

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'agent';
  content: string;
  timestamp: Date;
}

type SummaryData = {
  summary: {
    core_summary: string;
    current_issues: string[];
    customer_info: { email: string; started_at: string };
  };
};

export function ActiveChats({ user }: { user: AppUser }) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentMessage, setAgentMessage] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [summary, setSummary] = useState<SummaryData['summary'] | null>(null);
  const [closingChat, setClosingChat] = useState(false);

  const chatsRef = useRef<ChatSession[]>([]);
  const loadingChatsRef = useRef(false);
  const lastChatsRefreshRef = useRef(0);

  const categories = ['전체', '주문 문의', '환불 요청', '기술 지원', '계정 관리'];

  const filteredChats = useMemo(() => {
    return chats.filter((chat) => {
      const matchesCategory =
        filterCategory === 'all' || chat.category === filterCategory;
      const matchesSearch = (chat.customer_name || '')
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [chats, filterCategory, searchQuery]);

  const fetchChats = useCallback(async () => {
    try {
      setLoadingChats(true);
      const res = await apiCall<{ chats: ChatSession[] }>(
        `/api/admin/chats/active?category=${encodeURIComponent(
          filterCategory
        )}&search=${encodeURIComponent(searchQuery)}`
      );
      setChats(res.data?.chats || []);
    } finally {
      setLoadingChats(false);
    }
  }, [filterCategory, searchQuery]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    loadingChatsRef.current = loadingChats;
  }, [loadingChats]);

  useEffect(() => {
    void fetchChats();
  }, [fetchChats]);

  const ensureChatVisible = useCallback(
    (sessionId: string | null | undefined) => {
      if (!sessionId) return;
      if (loadingChatsRef.current) return;
      if (chatsRef.current.some((c) => c.id === sessionId)) return;
      const now = Date.now();
      if (now - lastChatsRefreshRef.current < 500) return;
      lastChatsRefreshRef.current = now;
      void fetchChats();
    },
    [fetchChats]
  );

  const mapApiMessage = useCallback((m: ApiMessage): ChatMessage => {
    return {
      id: m.id,
      sender: m.sender_type,
      content: m.content,
      timestamp: m.created_at ? new Date(m.created_at) : new Date(),
    };
  }, []);

  const fetchMessages = useCallback(
    async (sessionId: string) => {
      try {
        setLoadingMessages(true);
        const res = await apiCall<{ messages: ApiMessage[] }>(
          `/api/chats/messages/${encodeURIComponent(sessionId)}`
        );
        setMessages((res.data?.messages || []).map(mapApiMessage));
      } finally {
        setLoadingMessages(false);
      }
    },
    [mapApiMessage]
  );

  const fetchSummary = useCallback(async (sessionId: string) => {
    const res = await apiCall<SummaryData>(
      `/api/admin/chats/${encodeURIComponent(sessionId)}/summary`
    );
    setSummary(res.data?.summary || null);
  }, []);

  const handleTakeOver = useCallback(async () => {
    if (!selectedChat) return;
    const res = await apiCall(
      `/api/admin/chats/${encodeURIComponent(selectedChat.id)}/takeover`,
      {
        method: 'POST',
        body: JSON.stringify({ agent_id: user.id }),
      }
    );
    if (res.success) {
      setAgentMode(true);
      setChats((prev) =>
        prev.map((c) => (c.id === selectedChat.id ? { ...c, status: 'agent' } : c))
      );
      setSelectedChat((prev) => (prev ? { ...prev, status: 'agent' } : prev));
    }
  }, [selectedChat, user.id]);

  const handleSendMessage = useCallback(async () => {
    if (!agentMessage.trim() || !selectedChat) return;
    const content = agentMessage;
    setAgentMessage('');
    const res = await apiCall<{ message: ApiMessage }>('/api/chats/messages', {
      method: 'POST',
      body: JSON.stringify({ session_id: selectedChat.id, content }),
    });
    if (res.data?.message) {
      setMessages((prev) => {
        const mapped = mapApiMessage(res.data!.message);
        return prev.some((x) => x.id === mapped.id) ? prev : [...prev, mapped];
      });
    }
  }, [agentMessage, mapApiMessage, selectedChat]);

  const handleCompleteChat = useCallback(async () => {
    if (!selectedChat || closingChat) return;
    if (!window.confirm('이 채팅을 종료(완료 처리)하시겠습니까?')) return;

    try {
      setClosingChat(true);
      const summaryText =
        summary?.core_summary || '상담이 상담원에 의해 종료되었습니다.';
      await apiCall(
        `/api/admin/chats/${encodeURIComponent(selectedChat.id)}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ summary: summaryText }),
        }
      );

      // WS 이벤트(session_status_changed)로도 정리되지만, UI 반응을 위해 즉시 정리
      setChats((prev) => prev.filter((c) => c.id !== selectedChat.id));
      setSelectedChat(null);
      setMessages([]);
      setShowSummary(false);
      setSummary(null);
      setAgentMode(false);
      setAgentMessage('');
    } catch (e: any) {
      alert(e?.message || '채팅 종료에 실패했습니다.');
    } finally {
      setClosingChat(false);
    }
  }, [closingChat, selectedChat, summary]);

  const onWsMessage = useCallback((payload: any) => {
    if (!payload?.type) return;

    if (payload.type === 'new_message' && payload.data?.message) {
      const sessionId = payload.data.session_id || payload.data.message.session_id;
      const msg = payload.data.message as ApiMessage;
      ensureChatVisible(sessionId);

      setChats((prev) =>
        prev.map((c) =>
          c.id === sessionId
            ? {
                ...c,
                last_message: msg.content,
                timestamp: msg.created_at || c.timestamp,
              }
            : c
        )
      );

      if (selectedChat?.id === sessionId) {
        setMessages((prev) => {
          const mapped = mapApiMessage(msg);
          return prev.some((x) => x.id === mapped.id) ? prev : [...prev, mapped];
        });
      }
    } else if (payload.type === 'unread_count_updated') {
      const sessionId = payload.data?.session_id;
      const unread = payload.data?.unread_count;
      if (!sessionId) return;
      ensureChatVisible(sessionId);
      setChats((prev) =>
        prev.map((c) => (c.id === sessionId ? { ...c, unread: unread ?? c.unread } : c))
      );
    } else if (payload.type === 'session_status_changed') {
      const sessionId = payload.data?.session_id;
      const status = payload.data?.status;
      const handlerType = payload.data?.handler_type;
      if (!sessionId) return;
      if (status !== 'active') {
        setChats((prev) => prev.filter((c) => c.id !== sessionId));
        if (selectedChat?.id === sessionId) {
          setSelectedChat(null);
          setMessages([]);
          setShowSummary(false);
        }
      } else {
        ensureChatVisible(sessionId);
        if (!handlerType) return;
        setChats((prev) =>
          prev.map((c) =>
            c.id === sessionId ? { ...c, status: handlerType === 'agent' ? 'agent' : 'ai' } : c
          )
        );
      }
    }
  }, [ensureChatVisible, mapApiMessage, selectedChat]);

  useWebSocket(onWsMessage, {
    enabled: true,
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: 'subscribe_chats', data: { chat_type: 'active' } }));
    },
  });

  return (
    <div className="h-full flex overflow-hidden">
      {/* Chat list */}
      <div className="w-96 bg-white border-r border-gray-200 flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-gray-900 mb-4">상담 중인 채팅</h2>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="고객 검색..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="mb-3">
            <select
              value={filterCategory === 'all' ? '전체' : filterCategory}
              onChange={(e) =>
                setFilterCategory(e.target.value === '전체' ? 'all' : e.target.value)
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingChats && (
            <div className="p-4 text-gray-500">채팅 목록을 불러오는 중입니다...</div>
          )}
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => {
                setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unread: 0 } : c)));
                setSelectedChat({ ...chat, unread: 0 });
                setAgentMode(chat.status === 'agent');
                setShowSummary(false);
                setSummary(null);
                void fetchMessages(chat.id);
              }}
              className={`w-full p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors text-left ${
                selectedChat?.id === chat.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-900">{chat.customer_name}</span>
                  {chat.unread > 0 && (
                    <span className="px-2 py-0.5 bg-red-600 text-white rounded-full">
                      {chat.unread}
                    </span>
                  )}
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-white ${
                    chat.status === 'agent' ? 'bg-green-600' : 'bg-blue-600'
                  }`}
                >
                  {chat.status === 'agent' ? '상담원' : 'AI'}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                  {chat.category}
                </span>
              </div>
              <p className="text-gray-600 truncate mb-1">{chat.last_message}</p>
              <span className="text-gray-500">
                {chat.timestamp
                  ? new Date(chat.timestamp).toLocaleTimeString('ko-KR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Chat detail */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedChat ? (
          <>
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-gray-900 mb-1">
                    {selectedChat.customer_name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                      {selectedChat.category}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-white ${
                        selectedChat.status === 'agent'
                          ? 'bg-green-600'
                          : 'bg-blue-600'
                      }`}
                    >
                      {selectedChat.status === 'agent' ? '상담원 응대 중' : 'AI 응답 중'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const next = !showSummary;
                      setShowSummary(next);
                      if (next) void fetchSummary(selectedChat.id);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    AI 요약
                  </button>
                  {agentMode && (
                    <button
                      onClick={handleCompleteChat}
                      disabled={closingChat}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      채팅 종료
                    </button>
                  )}
                  {!agentMode && (
                    <button
                      onClick={handleTakeOver}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      직접 상담 진행
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden min-h-0">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
                {loadingMessages && (
                  <div className="text-gray-500">메시지를 불러오는 중입니다...</div>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.sender === 'user' ? 'flex-row' : 'flex-row-reverse'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.sender === 'user'
                          ? 'bg-gray-600'
                          : message.sender === 'agent'
                          ? 'bg-green-600'
                          : 'bg-blue-600'
                      }`}
                    >
                      {message.sender === 'user' ? (
                        <User className="w-4 h-4 text-white" />
                      ) : (
                        <Bot className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <div
                      className={`max-w-lg ${
                        message.sender === 'user' ? 'items-start' : 'items-end'
                      } flex flex-col gap-1`}
                    >
                      <div
                        className={`px-4 py-3 rounded-2xl ${
                          message.sender === 'user'
                            ? 'bg-white border border-gray-200 text-gray-900'
                            : 'bg-blue-600 text-white'
                        }`}
                      >
                        <p>{message.content}</p>
                      </div>
                      <span className="text-gray-500 px-2">
                        {message.timestamp.toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {showSummary && (
                <div className="w-80 bg-white border-l border-gray-200 p-4 overflow-y-auto min-h-0">
                  <h3 className="text-gray-900 mb-4">AI 요약</h3>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-gray-700 mb-2">상담 핵심 요약</h4>
                      <p className="text-gray-600">
                        {summary?.core_summary || '요약을 불러오는 중입니다...'}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-gray-700 mb-2">현재 이슈</h4>
                      <ul className="space-y-1 text-gray-600">
                        {(summary?.current_issues || []).length > 0 ? (
                          summary!.current_issues.map((issue) => <li key={issue}>• {issue}</li>)
                        ) : (
                          <li>• 없음</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-gray-700 mb-2">고객 정보</h4>
                      <p className="text-gray-600">
                        이메일: {selectedChat.customer_name}
                        <br />
                        상담 시작:{' '}
                        {summary?.customer_info?.started_at
                          ? new Date(summary.customer_info.started_at).toLocaleString('ko-KR')
                          : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {agentMode && (
              <div className="bg-white border-t border-gray-200 p-4">
                <div className="mb-2 px-4 py-2 bg-green-50 border border-green-200 text-green-800 rounded-lg">
                  상담원 모드: AI 자동 응답이 비활성화되었습니다
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={agentMessage}
                    onChange={(e) => setAgentMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') handleSendMessage();
                    }}
                    placeholder="고객에게 메시지 보내기..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!agentMessage.trim()}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquareIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>채팅을 선택하여 상담 내용을 확인하세요</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}
