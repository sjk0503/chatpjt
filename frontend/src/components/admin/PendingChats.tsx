import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Clock, FileText, AlertCircle, CheckCircle, Paperclip } from 'lucide-react';
import { User as AppUser } from '../../App';
import { apiCall } from '../../utils/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import { API_BASE_URL } from '../../config';

interface PendingChat {
  id: string;
  customer_id: string;
  customer_name: string;
  category: string;
  issue: string;
  wait_time: number; // in minutes
  priority: 'high' | 'medium' | 'low';
}

interface ApiMessage {
  id: string;
  session_id: string;
  sender_type: 'user' | 'ai' | 'agent';
  content: string;
  created_at?: string;
  attachments?: any[];
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'agent';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
}

type Attachment = {
  url: string;
  name: string;
  size?: number;
  mime?: string;
  is_image?: boolean;
};

export function PendingChats({ user, onSwitchToActive }: { user: AppUser; onSwitchToActive?: (sessionId?: string) => void }) {
  const [chats, setChats] = useState<PendingChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<PendingChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [responseText, setResponseText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const formatFileSize = (size?: number) => {
    if (size == null) return '';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  };

  const normalizeAttachment = useCallback((a: any): Attachment => {
    if (!a) return { url: '', name: '파일' };
    if (typeof a === 'string') {
      const parts = a.split('/');
      return { url: a, name: parts[parts.length - 1] || a, is_image: a.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i) != null };
    }
    return {
      url: a.url || '',
      name: a.name || '파일',
      size: typeof a.size === 'number' ? a.size : undefined,
      mime: a.mime || a.content_type,
      is_image: typeof a.is_image === 'boolean' ? a.is_image : (a.mime || a.content_type || '').startsWith('image/'),
    };
  }, []);

  const categories = ['전체', '주문 문의', '환불 요청', '기술 지원', '계정 관리'];
  const apiOrigin =
    (API_BASE_URL || '').replace(/\/api\/?$/, '') || `${window.location.protocol}//${window.location.host}`;
  const buildFileUrl = (url?: string) =>
    url && url.startsWith('http') ? url : `${apiOrigin}${url || ''}`;

  const fetchPendingChats = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiCall<{ chats: PendingChat[] }>(
        `/api/admin/chats/pending?category=${encodeURIComponent(
          filterCategory
        )}&search=${encodeURIComponent(searchQuery)}`
      );
      setChats(res.data?.chats || []);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, searchQuery]);

  useEffect(() => {
    void fetchPendingChats();
  }, [fetchPendingChats]);

  useWebSocket(
    (payload: any) => {
      if (!payload?.type) return;
      if (payload.type === 'new_chat_session') {
        void fetchPendingChats();
      } else if (payload.type === 'session_status_changed') {
        const status = payload.data?.status;
        if (status !== 'pending') {
          void fetchPendingChats();
          if (selectedChat?.id === payload.data?.session_id) {
            setSelectedChat(null);
            setMessages([]);
          }
        }
      }
    },
    {
      enabled: true,
      onOpen: (ws) => {
        ws.send(JSON.stringify({ type: 'subscribe_chats', data: { chat_type: 'pending' } }));
      },
    }
  );

  const filteredChats = useMemo(() => {
    return chats;
  }, [chats]);

  const sortMessages = useCallback((list: ChatMessage[]) => {
    const senderPriority: Record<ChatMessage['sender'], number> = { user: 0, agent: 1, ai: 2 };
    return [...list].sort((a, b) => {
      const tA = a.timestamp.getTime();
      const tB = b.timestamp.getTime();
      if (tA !== tB) return tA - tB;
      const pA = senderPriority[a.sender] ?? 99;
      const pB = senderPriority[b.sender] ?? 99;
      if (pA !== pB) return pA - pB;
      return a.id.localeCompare(b.id);
    });
  }, []);

  const mapApiMessage = useCallback((m: ApiMessage): ChatMessage => {
    return {
      id: m.id,
      sender: m.sender_type,
      content: m.content,
      timestamp: m.created_at ? new Date(m.created_at) : new Date(),
      attachments: Array.isArray(m.attachments) ? m.attachments.map(normalizeAttachment) : undefined,
    };
  }, [normalizeAttachment]);

  const fetchMessages = useCallback(
    async (sessionId: string) => {
      try {
        setLoadingMessages(true);
        const res = await apiCall<{ messages: ApiMessage[] }>(
          `/api/chats/messages/${encodeURIComponent(sessionId)}`
        );
        setMessages(sortMessages((res.data?.messages || []).map(mapApiMessage)));
      } finally {
        setLoadingMessages(false);
      }
    },
    [mapApiMessage, sortMessages]
  );

  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }
    void fetchMessages(selectedChat.id);
  }, [fetchMessages, selectedChat]);

  const handleProvideInfo = useCallback(async () => {
    if (!responseText.trim() || !selectedChat) return;
    await apiCall(`/api/admin/chats/${encodeURIComponent(selectedChat.id)}/provide-info`, {
      method: 'POST',
      body: JSON.stringify({ info: responseText }),
    });
    alert('AI에게 정보를 전달했습니다. AI가 고객에게 응답합니다.');
    setResponseText('');
    setSelectedChat(null);
    await fetchPendingChats();
  }, [fetchPendingChats, responseText, selectedChat]);

  const handleDirectResponse = useCallback(async () => {
    if (!selectedChat) return;
    await apiCall(`/api/admin/chats/${encodeURIComponent(selectedChat.id)}/takeover`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: user.id }),
    });
    const go = window.confirm('상담원 모드로 전환되었습니다. 상담 중인 채팅 탭으로 이동하시겠습니까?');
    if (go && onSwitchToActive) {
      onSwitchToActive(selectedChat.id);
    }
    setSelectedChat(null);
    await fetchPendingChats();
  }, [fetchPendingChats, onSwitchToActive, selectedChat, user.id]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Pending list */}
      <div className="w-96 bg-white border-r border-gray-200 flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-gray-900 mb-4">처리 대기 중인 채팅</h2>

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
            <label className="block text-gray-700 mb-2">카테고리</label>
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
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              대기 채팅 목록을 불러오는 중입니다...
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              처리 대기 중인 채팅이 없습니다.
            </div>
          ) : (
            filteredChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => setSelectedChat(chat)}
                className={`w-full p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors text-left ${
                  selectedChat?.id === chat.id ? 'bg-orange-50' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-gray-900">{chat.customer_name}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-white ${
                      chat.priority === 'high'
                        ? 'bg-red-600'
                        : chat.priority === 'medium'
                        ? 'bg-orange-600'
                        : 'bg-yellow-600'
                    }`}
                  >
                    {chat.priority === 'high'
                      ? '높음'
                      : chat.priority === 'medium'
                      ? '보통'
                      : '낮음'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                    {chat.category}
                  </span>
                </div>
                <p className="text-gray-600 mb-2 line-clamp-2">{chat.issue}</p>
                <div className="flex items-center gap-1 text-orange-600">
                  <Clock className="w-4 h-4" />
                  <span>대기 시간: {chat.wait_time}분</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail view */}
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
                        selectedChat.priority === 'high'
                          ? 'bg-red-600'
                          : selectedChat.priority === 'medium'
                          ? 'bg-orange-600'
                          : 'bg-yellow-600'
                      }`}
                    >
                      우선순위:{' '}
                      {selectedChat.priority === 'high'
                        ? '높음'
                        : selectedChat.priority === 'medium'
                        ? '보통'
                        : '낮음'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              <div className="max-w-3xl space-y-6">
                {/* AI Summary */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <h3 className="text-gray-900">AI 요약 정보</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-gray-700 mb-2">고객 요청 요지</h4>
                      <p className="text-gray-600">{selectedChat.issue}</p>
                    </div>
                    <div>
                      <h4 className="text-gray-700 mb-2">필요한 처리 항목</h4>
                      <ul className="space-y-1 text-gray-600">
                        <li>• 관리자 권한으로 예외 처리 검토 필요</li>
                        <li>• 고객 계정 및 주문 이력 확인 필요</li>
                        <li>• 회사 정책 범위 내 해결 방안 제시</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-gray-700 mb-2">주문/계정 연관 정보</h4>
                      <div className="bg-gray-50 rounded p-3 text-gray-600">
                        <p>고객 ID: {selectedChat.customer_id}</p>
                        <p>이메일: {selectedChat.customer_name}</p>
                        <p>대기 시간: {selectedChat.wait_time}분</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Issue Details */}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                    <h3 className="text-gray-900">처리 필요 사항</h3>
                  </div>
                  <p className="text-gray-700">
                    이 상담은 AI가 단독으로 처리할 수 없다고 판단한 케이스입니다.
                    관리자의 검토와 승인이 필요합니다.
                  </p>
                </div>

                {/* Action panel */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-gray-900 mb-4">처리 방법 선택</h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-gray-700 mb-2">
                        AI에게 처리 지침 전달
                      </label>
                      <textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="AI가 고객에게 전달할 정보나 처리 방법을 입력하세요..."
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                        rows={4}
                      />
                      <div className="mt-3 space-y-3">
                        <button
                          onClick={handleProvideInfo}
                          disabled={!responseText.trim()}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          <CheckCircle className="w-4 h-4" />
                          AI에게 정보 전달
                        </button>
                        <button
                          onClick={handleDirectResponse}
                          className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          직접 응답하기
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full conversation log (bottom) */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-900">전체 대화 로그</h3>
                    <button
                      onClick={() => selectedChat && fetchMessages(selectedChat.id)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      새로고침
                    </button>
                  </div>
                  {loadingMessages && (
                    <div className="text-gray-500 mb-2">대화 로그를 불러오는 중입니다...</div>
                  )}
                  {messages.length === 0 ? (
                    <p className="text-gray-500">대화가 없습니다.</p>
                  ) : (
                    <div className="space-y-3 text-gray-600 max-h-[420px] overflow-y-auto pr-1">
                      {messages.map((m) => (
                        <div key={m.id} className="flex gap-2">
                          <span
                            className={`px-2 py-1 rounded ${
                      m.sender === 'user'
                        ? 'bg-gray-100 text-gray-700'
                        : m.sender === 'agent'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                      }`}
                      >
                        {m.sender === 'user' ? '고객' : m.sender === 'agent' ? '상담원' : 'AI'}
                      </span>
                      <div className="flex-1">
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        {m.attachments && (
                          <div className="mt-2 space-y-2">
                            {m.attachments.map((file, idx) => {
                              const url = buildFileUrl(file.url);
                              const isImage = file.is_image || (file.mime || '').startsWith('image/');
                              return (
                                <div key={idx} className="rounded border border-gray-200">
                                  <div className="flex items-center justify-between px-3 py-2 text-sm bg-gray-50">
                                    <div className="flex items-center gap-2">
                                      <Paperclip className="w-4 h-4" />
                                      <span className="break-all">{file.name || '첨부파일'}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">{formatFileSize(file.size)}</div>
                                  </div>
                                  <div className="bg-white">
                                    {isImage ? (
                                      <a href={url} target="_blank" rel="noreferrer">
                                        <img src={url} alt={file.name || '이미지'} className="max-h-72 w-full object-contain" />
                                      </a>
                                    ) : (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        download={file.name || true}
                                        className="block px-3 py-2 text-blue-600 hover:underline"
                                      >
                                        다운로드
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="text-xs text-gray-400">
                          {m.timestamp.toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Clock className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>대기 중인 채팅을 선택하여 처리하세요</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
