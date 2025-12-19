import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Calendar, Download, Paperclip } from 'lucide-react';
import { apiCall } from '../../utils/api';
import { API_BASE_URL } from '../../config';

interface CompletedChat {
  id: string;
  customer_id: string;
  customer_name: string;
  category: string;
  handled_by: 'AI' | '상담원';
  duration: number; // in minutes
  completed_at: string | null;
  summary: string;
}

type ApiMessage = {
  id: string;
  sender_type: 'user' | 'ai' | 'agent';
  content: string;
  created_at?: string;
  attachments?: any[];
};

type ChatMessage = {
  id: string;
  sender: 'user' | 'ai' | 'agent';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
};

type Attachment = {
  url: string;
  name: string;
  size?: number;
  mime?: string;
  is_image?: boolean;
};

export function CompletedChats() {
  const [chats, setChats] = useState<CompletedChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<CompletedChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterHandler, setFilterHandler] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<string>('all');
  const [loadingChats, setLoadingChats] = useState(false);
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

  const categories = ['전체', '주문 문의', '환불 요청', '기술 지원', '계정 관리'];
  const handlers = ['전체', 'AI', '상담원'];
  const dateRanges = [
    { value: 'all', label: '전체 기간' },
    { value: 'today', label: '오늘' },
    { value: 'week', label: '최근 7일' },
    { value: 'month', label: '최근 30일' },
  ];
  const apiOrigin =
    (API_BASE_URL || '').replace(/\/api\/?$/, '') || `${window.location.protocol}//${window.location.host}`;
  const buildFileUrl = (url?: string) =>
    url && url.startsWith('http') ? url : `${apiOrigin}${url || ''}`;

  const fetchCompletedChats = useCallback(async () => {
    try {
      setLoadingChats(true);
      const res = await apiCall<{ chats: CompletedChat[] }>(
        `/api/admin/chats/completed?category=${encodeURIComponent(
          filterCategory
        )}&handler=${encodeURIComponent(filterHandler)}&dateRange=${encodeURIComponent(
          dateRange
        )}&search=${encodeURIComponent(searchQuery)}`
      );
      setChats(res.data?.chats || []);
    } finally {
      setLoadingChats(false);
    }
  }, [dateRange, filterCategory, filterHandler, searchQuery]);

  useEffect(() => {
    void fetchCompletedChats();
  }, [fetchCompletedChats]);

  const filteredChats = useMemo(() => chats, [chats]);

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

  const handleExport = () => {
    alert('상담 기록을 내보냅니다.');
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Completed list */}
      <div className="w-96 bg-white border-r border-gray-200 flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-gray-900 mb-4">상담 완료된 채팅</h2>

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

          <div className="space-y-3">
            <div>
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

            <div>
              <label className="block text-gray-700 mb-2">처리 주체</label>
              <select
                value={filterHandler === 'all' ? '전체' : filterHandler}
                onChange={(e) =>
                  setFilterHandler(e.target.value === '전체' ? 'all' : e.target.value)
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {handlers.map((handler) => (
                  <option key={handler} value={handler}>
                    {handler}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-700 mb-2">기간</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {dateRanges.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingChats ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              완료된 채팅 목록을 불러오는 중입니다...
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              완료된 채팅이 없습니다.
            </div>
          ) : (
            filteredChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => {
                  setSelectedChat(chat);
                  void fetchMessages(chat.id);
                }}
                className={`w-full p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors text-left ${
                  selectedChat?.id === chat.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-gray-900">{chat.customer_name}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-white ${
                      chat.handled_by === 'AI' ? 'bg-blue-600' : 'bg-green-600'
                    }`}
                  >
                    {chat.handled_by === 'AI' ? 'AI' : '상담원'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                    {chat.category}
                  </span>
                </div>
                <p className="text-gray-600 mb-2 line-clamp-1">{chat.summary}</p>
                <div className="flex items-center justify-between text-gray-500">
                  <span>소요: {chat.duration}분</span>
                  <span>
                    {chat.completed_at
                      ? new Date(chat.completed_at).toLocaleDateString('ko-KR', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>
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
                        selectedChat.handled_by === 'AI'
                          ? 'bg-blue-600'
                          : 'bg-green-600'
                      }`}
                    >
                      처리: {selectedChat.handled_by === 'AI' ? 'AI' : '상담원'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  내보내기
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              <div className="max-w-3xl space-y-6">
                {/* Summary */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-gray-900 mb-4">상담 요약</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-700">고객:</span>
                      <span className="text-gray-900">
                        {selectedChat.customer_name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">카테고리:</span>
                      <span className="text-gray-900">{selectedChat.category}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">처리자:</span>
                      <span className="text-gray-900">
                        {selectedChat.handled_by === 'AI' ? 'AI' : '상담원'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">소요 시간:</span>
                      <span className="text-gray-900">{selectedChat.duration}분</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">완료 시간:</span>
                      <span className="text-gray-900">
                        {selectedChat.completed_at
                          ? new Date(selectedChat.completed_at).toLocaleString('ko-KR')
                          : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Summary text */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <h4 className="text-gray-900 mb-2">상담 내용 요약</h4>
                  <p className="text-gray-700">{selectedChat.summary}</p>
                </div>

                {/* Full conversation log */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-gray-900 mb-4">전체 대화 로그</h3>
                  <div className="space-y-3 text-gray-600">
                    {loadingMessages && (
                      <div className="text-gray-500">대화 로그를 불러오는 중입니다...</div>
                    )}
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
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>완료된 채팅을 선택하여 상세 내역을 확인하세요</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
