import { useState } from 'react';
import { Save, Plus, X, Info } from 'lucide-react';

export function ChatbotSettings() {
  const [greeting, setGreeting] = useState('안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?');
  const [farewell, setFarewell] = useState('상담이 완료되었습니다. 좋은 하루 되세요!');
  const [companyPolicy, setCompanyPolicy] = useState(
    '환불은 구매 후 7일 이내에 가능합니다.\n배송비는 고객 부담입니다.\n제품 하자의 경우 무료 교환이 가능합니다.'
  );
  const [categories, setCategories] = useState([
    '주문 문의',
    '환불 요청',
    '기술 지원',
    '계정 관리',
  ]);
  const [newCategory, setNewCategory] = useState('');
  const [humanInterventionRules, setHumanInterventionRules] = useState(
    '고객이 환불을 요청하는 경우\n기술적 문제 해결이 어려운 경우\n고객이 불만을 표현하는 경우'
  );
  const [responseWaitTime, setResponseWaitTime] = useState('5');
  const [autoClose, setAutoClose] = useState(true);

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      setCategories([...categories, newCategory.trim()]);
      setNewCategory('');
    }
  };

  const handleRemoveCategory = (category: string) => {
    setCategories(categories.filter((c) => c !== category));
  };

  const handleSaveSettings = () => {
    alert('설정이 저장되었습니다.');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div>
          <h2 className="text-gray-900 mb-2">챗봇 설정</h2>
          <p className="text-gray-600">
            AI 상담 챗봇의 동작 방식과 정책을 설정합니다
          </p>
        </div>

        {/* Greeting settings */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-gray-900 mb-4">1. 기본 인사말 설정</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-700 mb-2">첫 인사말</label>
              <textarea
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={2}
                placeholder="고객이 상담을 시작할 때 표시될 메시지"
              />
            </div>
            <div>
              <label className="block text-gray-700 mb-2">마지막 인사말</label>
              <textarea
                value={farewell}
                onChange={(e) => setFarewell(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={2}
                placeholder="상담 종료 시 표시될 메시지"
              />
            </div>
          </div>
        </div>

        {/* Company policy */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-gray-900 mb-4">2. 사내 정책 관리</h3>
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex gap-2">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-blue-800">
              입력하신 정책은 AI가 상담 시 참고하여 응답합니다.
            </p>
          </div>
          <textarea
            value={companyPolicy}
            onChange={(e) => setCompanyPolicy(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={6}
            placeholder="회사 정책, 규정, FAQ 등을 입력하세요"
          />
        </div>

        {/* Categories */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-gray-900 mb-4">3. 상담 카테고리 설정</h3>
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex gap-2">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-blue-800">
              AI가 자동으로 상담을 분류하는 기준이 됩니다.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <div
                  key={category}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg"
                >
                  <span className="text-gray-700">{category}</span>
                  <button
                    onClick={() => handleRemoveCategory(category)}
                    className="text-gray-500 hover:text-red-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                placeholder="새 카테고리 입력"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAddCategory}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                추가
              </button>
            </div>
          </div>
        </div>

        {/* Human intervention rules */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-gray-900 mb-4">4. 사람 개입 규칙 설정</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-gray-700 mb-2">
                사람 개입이 필요한 상황
              </label>
              <textarea
                value={humanInterventionRules}
                onChange={(e) => setHumanInterventionRules(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={4}
                placeholder="AI가 사람에게 상담을 넘겨야 하는 기준을 입력하세요"
              />
            </div>

            <div>
              <label className="block text-gray-700 mb-2">
                응답 대기 시간 안내 (분)
              </label>
              <input
                type="number"
                value={responseWaitTime}
                onChange={(e) => setResponseWaitTime(e.target.value)}
                min="1"
                max="60"
                className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-2 text-gray-600">
                AI가 처리할 수 없는 경우, "말씀해주신 내용 관련해서 추가적으로 확인 후 {responseWaitTime}분 이내에 답변드리도록 하겠습니다."라고 안내합니다
              </p>
            </div>

            <div>
              <label className="block text-gray-700 mb-2">채팅 종료 방식</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="closeMethod"
                    checked={autoClose}
                    onChange={() => setAutoClose(true)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-gray-700">AI가 자동으로 종료</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="closeMethod"
                    checked={!autoClose}
                    onChange={() => setAutoClose(false)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-gray-700">사용자 요청 시에만 종료</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSaveSettings}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Save className="w-5 h-5" />
            설정 저장
          </button>
        </div>
      </div>
    </div>
  );
}