import { useState } from 'react';
import { Search, Clock, FileText, AlertCircle, CheckCircle } from 'lucide-react';

interface PendingChat {
  id: string;
  customerId: string;
  customerName: string;
  category: string;
  issue: string;
  waitTime: number; // in minutes
  priority: 'high' | 'medium' | 'low';
}

const mockPendingChats: PendingChat[] = [
  {
    id: '1',
    customerId: 'user4',
    customerName: 'user4@example.com',
    category: '환불 요청',
    issue: '고객이 환불 정책 예외 사항을 요청하고 있습니다',
    waitTime: 45,
    priority: 'high',
  },
  {
    id: '2',
    customerId: 'user5',
    customerName: 'user5@example.com',
    category: '주문 문의',
    issue: '배송지 변경 요청 - 이미 발송된 주문',
    waitTime: 30,
    priority: 'medium',
  },
  {
    id: '3',
    customerId: 'user6',
    customerName: 'user6@example.com',
    category: '계정 관리',
    issue: '계정 복구 요청 - 추가 인증 필요',
    waitTime: 15,
    priority: 'low',
  },
];

export function PendingChats() {
  const [selectedChat, setSelectedChat] = useState<PendingChat | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [responseText, setResponseText] = useState('');

  const categories = ['전체', '주문 문의', '환불 요청', '기술 지원', '계정 관리'];

  const filteredChats = mockPendingChats.filter((chat) => {
    const matchesCategory =
      filterCategory === 'all' || chat.category === filterCategory;
    const matchesSearch = chat.customerName
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleProvideInfo = () => {
    if (!responseText.trim()) return;
    alert('AI에게 정보를 전달했습니다. AI가 고객에게 응답합니다.');
    setResponseText('');
  };

  const handleDirectResponse = () => {
    alert('직접 응답 모드로 전환합니다.');
  };

  return (
    <div className="h-full flex">
      {/* Pending list */}
      <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
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
                selectedChat?.id === chat.id ? 'bg-orange-50' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-gray-900">{chat.customerName}</span>
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
                <span>대기 시간: {chat.waitTime}분</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail view */}
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

            <div className="flex-1 overflow-y-auto p-6">
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
                        <p>고객 ID: {selectedChat.customerId}</p>
                        <p>이메일: {selectedChat.customerName}</p>
                        <p>대기 시간: {selectedChat.waitTime}분</p>
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
                      <button
                        onClick={handleProvideInfo}
                        disabled={!responseText.trim()}
                        className="mt-2 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        <CheckCircle className="w-4 h-4" />
                        AI에게 정보 전달
                      </button>
                    </div>

                    <div className="border-t border-gray-200 pt-4">
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