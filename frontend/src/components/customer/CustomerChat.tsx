import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from '../../App';
import { Send, Paperclip, Bot, User as UserIcon, LogOut } from 'lucide-react';
import { apiCall } from '../../utils/api';
import { useWebSocket } from '../../hooks/useWebSocket';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  timestamp: Date;
  attachments?: string[];
}

type ApiMessage = {
  id: string;
  sender_type: 'user' | 'ai' | 'agent';
  content: string;
  created_at?: string;
  attachments?: any[];
};

interface CustomerChatProps {
  user: User;
  onLogout: () => void;
}

export function CustomerChat({ user, onLogout }: CustomerChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatEnded, setChatEnded] = useState(false);
  const [logoutCountdown, setLogoutCountdown] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortMessages = useCallback((list: Message[]) => {
    const senderPriority: Record<Message['sender'], number> = { user: 0, ai: 1 };
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

  const addMessage = useCallback((m: Message) => {
    setMessages((prev) => {
      if (prev.some((x) => x.id === m.id)) return prev;
      return sortMessages([...prev, m]);
    });
  }, [sortMessages]);

  const mapApiMessage = useCallback((m: ApiMessage): Message => {
    return {
      id: m.id,
      // 고객 화면에서는 AI/상담원 여부를 구분하지 않는다.
      sender: m.sender_type === 'user' ? 'user' : 'ai',
      content: m.content,
      timestamp: m.created_at ? new Date(m.created_at) : new Date(),
      attachments: Array.isArray(m.attachments) ? m.attachments.map(String) : undefined,
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiCall<{ session: { id: string }; messages: ApiMessage[] }>(
          '/api/chats/session'
        );
        if (!res.data) throw new Error('세션 정보를 불러오지 못했습니다.');
        setSessionId(res.data.session.id);
        setMessages(sortMessages(res.data.messages.map(mapApiMessage)));
      } catch (e: any) {
        setError(e?.message || '세션을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [mapApiMessage, sortMessages]);

  useEffect(() => {
    if (!chatEnded || logoutCountdown == null) return;
    if (logoutCountdown <= 0) {
      onLogout();
      return;
    }
    const timer = window.setTimeout(() => {
      setLogoutCountdown((prev) => (prev == null ? null : prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [chatEnded, logoutCountdown, onLogout]);

  const onWsMessage = useCallback(
    (payload: any) => {
      if (!payload?.type) return;

      if (payload.type === 'new_message' && payload.data?.message) {
        addMessage(mapApiMessage(payload.data.message as ApiMessage));
      } else if (payload.type === 'session_completed') {
        const msg = payload.data?.message || '상담이 완료되었습니다.';
        setChatEnded(true);
        setLogoutCountdown(10);
        addMessage({
          id: `system-${Date.now()}`,
          sender: 'ai',
          content: msg,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, mapApiMessage]
  );

  useWebSocket(onWsMessage, { enabled: true });

  const handleSend = async (content: string, attachments?: string[]) => {
    if (!sessionId || !content.trim() || chatEnded) return;
    try {
      setError(null);
      const res = await apiCall<{ message: ApiMessage }>('/api/chats/messages', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, content, attachments }),
      });
      if (res.data?.message) {
        addMessage(mapApiMessage(res.data.message));
      }
    } catch (e: any) {
      setError(e?.message || '메시지 전송에 실패했습니다.');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatEnded) return;
      const content = inputText;
      setInputText('');
      void handleSend(content);
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (chatEnded) return;
      const fileName = files[0].name;
      void handleSend(`파일 첨부: ${fileName}`, [fileName]);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-gray-900">1:1 상담</span>
              </div>
              <p className="text-gray-600">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onLogout}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="로그아웃"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
          {loading && (
            <div className="text-gray-500">상담 세션을 불러오는 중입니다...</div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.sender === 'user'
                    ? 'bg-blue-600'
                    : 'bg-gray-600'
                }`}
              >
                {message.sender === 'user' ? (
                  <UserIcon className="w-4 h-4 text-white" />
                ) : (
                  <Bot className="w-4 h-4 text-white" />
                )}
              </div>

              {/* Message bubble */}
              <div
                className={`max-w-lg ${
                  message.sender === 'user' ? 'items-end' : 'items-start'
                } flex flex-col gap-1`}
              >
                <div
                  className={`px-4 py-3 rounded-2xl ${
                    message.sender === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-900'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  {message.attachments && (
                    <div className="mt-2 text-white/80">
                      {message.attachments.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Paperclip className="w-4 h-4" />
                          <span>{file}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          {chatEnded && logoutCountdown != null && (
            <div className="mb-3 px-4 py-2 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg">
              상담이 종료되었습니다. {logoutCountdown}초 뒤에 로그아웃됩니다.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleFileClick}
              className="p-3 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title="파일 첨부"
              disabled={loading || chatEnded}
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx"
            />
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="메시지를 입력하세요..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading || !sessionId || chatEnded}
            />
            <button
              onClick={() => {
                if (chatEnded) return;
                const content = inputText;
                setInputText('');
                void handleSend(content);
              }}
              disabled={loading || !sessionId || chatEnded || !inputText.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageSquare({ className }: { className?: string }) {
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
