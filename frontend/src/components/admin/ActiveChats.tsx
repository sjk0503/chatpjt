import { useState } from 'react';
import { Search, Filter, FileText, User, Bot, Send } from 'lucide-react';

interface ChatSession {
  id: string;
  customerId: string;
  customerName: string;
  category: string;
  lastMessage: string;
  timestamp: Date;
  status: 'ai' | 'agent';
  unread: number;
}

const mockChats: ChatSession[] = [
  {
    id: '1',
    customerId: 'user1',
    customerName: 'user1@example.com',
    category: '주문 문의',
    lastMessage: '주문한 상품이 언제 도착하나요?',
    timestamp: new Date(Date.now() - 5 * 60000),
    status: 'ai',
    unread: 2,
  },
  {
    id: '2',
    customerId: 'user2',
    customerName: 'user2@example.com',
    category: '환불 요청',
    lastMessage: '환불 처리가 가능한가요?',
    timestamp: new Date(Date.now() - 15 * 60000),
    status: 'agent',
    unread: 0,
  },
  {
    id: '3',
    customerId: 'user3',
    customerName: 'user3@example.com',
    category: '기술 지원',
    lastMessage: '로그인이 안 됩니다',
    timestamp: new Date(Date.now() - 30 * 60000),
    status: 'ai',
    unread: 1,
  },
];

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'agent';
  content: string;
  timestamp: Date;
}

const mockMessages: ChatMessage[] = [
  {
    id: '1',
    sender: 'ai',
    content: '안녕하세요! 무엇을 도와드릴까요?',
    timestamp: new Date(Date.now() - 35 * 60000),
  },
  {
    id: '2',
    sender: 'user',
    content: '주문한 상품이 언제 도착하나요?',
    timestamp: new Date(Date.now() - 30 * 60000),
  },
  {
    id: '3',
    sender: 'ai',
    content: '주문번호를 알려주시면 배송 상태를 확인해드리겠습니다.',
    timestamp: new Date(Date.now() - 25 * 60000),
  },
];

export function ActiveChats() {
  const [selectedChat, setSelectedChat] = useState<ChatSession | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentMessage, setAgentMessage] = useState('');

  const categories = ['전체', '주문 문의', '환불 요청', '기술 지원', '계정 관리'];

  const filteredChats = mockChats.filter((chat) => {
    const matchesCategory =
      filterCategory === 'all' || chat.category === filterCategory;
    const matchesSearch = chat.customerName
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleTakeOver = () => {
    setAgentMode(true);
  };

  const handleSendMessage = () => {
    if (!agentMessage.trim()) return;
    // In a real app, send message to customer
    setAgentMessage('');
  };

  return (
    <div className="h-full flex">
      {/* Chat list */}
      <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
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

        <div className="flex-1 overflow-y-auto">
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => setSelectedChat(chat)}
              className={`w-full p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors text-left ${
                selectedChat?.id === chat.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-900">{chat.customerName}</span>
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
              <p className="text-gray-600 truncate mb-1">{chat.lastMessage}</p>
              <span className="text-gray-500">
                {chat.timestamp.toLocaleTimeString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Chat detail */}
      <div className="flex-1 flex flex-col">
        {selectedChat ? (
          <>
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-gray-900 mb-1">
                    {selectedChat.customerName}
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
                    onClick={() => setShowSummary(!showSummary)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    AI 요약
                  </button>
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

            <div className="flex-1 flex">
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {mockMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.sender === 'user'
                          ? 'bg-blue-600'
                          : message.sender === 'agent'
                          ? 'bg-green-600'
                          : 'bg-gray-600'
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
                <div className="w-80 bg-white border-l border-gray-200 p-4">
                  <h3 className="text-gray-900 mb-4">AI 요약</h3>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-gray-700 mb-2">상담 핵심 요약</h4>
                      <p className="text-gray-600">
                        고객이 주문한 상품의 배송 상태를 문의하고 있습니다.
                        주문번호 확인이 필요합니다.
                      </p>
                    </div>
                    <div>
                      <h4 className="text-gray-700 mb-2">현재 이슈</h4>
                      <ul className="space-y-1 text-gray-600">
                        <li>• 주문번호 미확인</li>
                        <li>• 배송 조회 대기</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-gray-700 mb-2">고객 정보</h4>
                      <p className="text-gray-600">
                        이메일: {selectedChat.customerName}
                        <br />
                        상담 시작: {selectedChat.timestamp.toLocaleString('ko-KR')}
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