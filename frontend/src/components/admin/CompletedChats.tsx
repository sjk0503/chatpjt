import { useState } from 'react';
import { Search, Calendar, Download, Eye } from 'lucide-react';

interface CompletedChat {
  id: string;
  customerId: string;
  customerName: string;
  category: string;
  handledBy: 'AI' | 'Agent';
  duration: number; // in minutes
  completedAt: Date;
  summary: string;
}

const mockCompletedChats: CompletedChat[] = [
  {
    id: '1',
    customerId: 'user7',
    customerName: 'user7@example.com',
    category: '주문 문의',
    handledBy: 'AI',
    duration: 8,
    completedAt: new Date(Date.now() - 2 * 60 * 60000),
    summary: '배송 조회 문의 - 정상 처리 완료',
  },
  {
    id: '2',
    customerId: 'user8',
    customerName: 'user8@example.com',
    category: '환불 요청',
    handledBy: 'Agent',
    duration: 25,
    completedAt: new Date(Date.now() - 4 * 60 * 60000),
    summary: '환불 승인 및 처리 완료',
  },
  {
    id: '3',
    customerId: 'user9',
    customerName: 'user9@example.com',
    category: '기술 지원',
    handledBy: 'AI',
    duration: 12,
    completedAt: new Date(Date.now() - 6 * 60 * 60000),
    summary: '로그인 문제 해결 - 비밀번호 재설정',
  },
  {
    id: '4',
    customerId: 'user10',
    customerName: 'user10@example.com',
    category: '계정 관리',
    handledBy: 'Agent',
    duration: 18,
    completedAt: new Date(Date.now() - 1 * 24 * 60 * 60000),
    summary: '계정 정보 업데이트 지원',
  },
  {
    id: '5',
    customerId: 'user11',
    customerName: 'user11@example.com',
    category: '주문 문의',
    handledBy: 'AI',
    duration: 5,
    completedAt: new Date(Date.now() - 2 * 24 * 60 * 60000),
    summary: '주문 상태 확인',
  },
];

export function CompletedChats() {
  const [selectedChat, setSelectedChat] = useState<CompletedChat | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterHandler, setFilterHandler] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<string>('all');

  const categories = ['전체', '주문 문의', '환불 요청', '기술 지원', '계정 관리'];
  const handlers = ['전체', 'AI', '상담원'];
  const dateRanges = [
    { value: 'all', label: '전체 기간' },
    { value: 'today', label: '오늘' },
    { value: 'week', label: '최근 7일' },
    { value: 'month', label: '최근 30일' },
  ];

  const filteredChats = mockCompletedChats.filter((chat) => {
    const matchesCategory =
      filterCategory === 'all' || chat.category === filterCategory;
    const matchesHandler =
      filterHandler === 'all' ||
      (filterHandler === 'AI' && chat.handledBy === 'AI') ||
      (filterHandler === '상담원' && chat.handledBy === 'Agent');
    const matchesSearch = chat.customerName
      .toLowerCase()
      .includes(searchQuery.toLowerCase());

    // Simple date filtering
    let matchesDate = true;
    if (dateRange === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      matchesDate = chat.completedAt >= today;
    } else if (dateRange === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60000);
      matchesDate = chat.completedAt >= weekAgo;
    } else if (dateRange === 'month') {
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60000);
      matchesDate = chat.completedAt >= monthAgo;
    }

    return matchesCategory && matchesHandler && matchesSearch && matchesDate;
  });

  const handleExport = () => {
    alert('상담 기록을 내보냅니다.');
  };

  return (
    <div className="h-full flex">
      {/* Completed list */}
      <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
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
                <span className="text-gray-900">{chat.customerName}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-white ${
                    chat.handledBy === 'AI' ? 'bg-blue-600' : 'bg-green-600'
                  }`}
                >
                  {chat.handledBy === 'AI' ? 'AI' : '상담원'}
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
                  {chat.completedAt.toLocaleDateString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
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
                        selectedChat.handledBy === 'AI'
                          ? 'bg-blue-600'
                          : 'bg-green-600'
                      }`}
                    >
                      처리: {selectedChat.handledBy === 'AI' ? 'AI' : '상담원'}
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

            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-3xl space-y-6">
                {/* Summary */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-gray-900 mb-4">상담 요약</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-700">고객:</span>
                      <span className="text-gray-900">
                        {selectedChat.customerName}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">카테고리:</span>
                      <span className="text-gray-900">{selectedChat.category}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">처리자:</span>
                      <span className="text-gray-900">
                        {selectedChat.handledBy === 'AI' ? 'AI' : '상담원'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">소요 시간:</span>
                      <span className="text-gray-900">{selectedChat.duration}분</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">완료 시간:</span>
                      <span className="text-gray-900">
                        {selectedChat.completedAt.toLocaleString('ko-KR')}
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
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                        AI
                      </span>
                      <p>안녕하세요! 무엇을 도와드릴까요?</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
                        고객
                      </span>
                      <p>주문 상태를 확인하고 싶습니다.</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                        AI
                      </span>
                      <p>주문번호를 알려주시면 확인해드리겠습니다.</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
                        고객
                      </span>
                      <p>주문번호는 ORD-12345입니다.</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                        AI
                      </span>
                      <p>
                        확인했습니다. 현재 배송 중이며, 내일 도착 예정입니다.
                        감사합니다!
                      </p>
                    </div>
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