import { useEffect, useState } from 'react';
import { Save, Plus, X, Info } from 'lucide-react';
import { apiCall } from '../../utils/api';

export function ChatbotSettings() {
  const [greeting, setGreeting] = useState('');
  const [farewell, setFarewell] = useState('');
  const [companyPolicy, setCompanyPolicy] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [humanInterventionRules, setHumanInterventionRules] = useState('');
  const [responseWaitTime, setResponseWaitTime] = useState('5');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiCall<{
          greeting: string;
          farewell: string;
          company_policy: string;
          categories: string[];
          human_intervention_rules: string;
          response_wait_time: number;
          auto_close: boolean;
        }>('/api/admin/chatbot/settings');

        if (!res.data) throw new Error('설정 정보를 불러오지 못했습니다.');

        setGreeting(res.data.greeting);
        setFarewell(res.data.farewell);
        setCompanyPolicy(res.data.company_policy);
        setCategories(res.data.categories || []);
        setHumanInterventionRules(res.data.human_intervention_rules);
        setResponseWaitTime(String(res.data.response_wait_time ?? 5));
      } catch (e: any) {
        setError(e?.message || '설정 정보를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };

    void fetchSettings();
  }, []);

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      setCategories([...categories, newCategory.trim()]);
      setNewCategory('');
    }
  };

  const handleRemoveCategory = (category: string) => {
    setCategories(categories.filter((c) => c !== category));
  };

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setError(null);

      const waitTimeParsed = Number.parseInt(responseWaitTime, 10);
      const waitTime = Number.isFinite(waitTimeParsed) && waitTimeParsed > 0 && waitTimeParsed <= 60 ? waitTimeParsed : 5;
      const trimmedCategories = categories.map((c) => c.trim()).filter(Boolean);

      await apiCall(
        '/api/admin/chatbot/settings',
        {
          method: 'PUT',
          body: JSON.stringify({
            greeting,
            farewell,
            company_policy: companyPolicy,
            categories: trimmedCategories,
            human_intervention_rules: humanInterventionRules,
            response_wait_time: waitTime,
            auto_close: true,
          }),
        },
        { auth: true }
      );
      alert('설정이 저장되었습니다.');
    } catch (e: any) {
      setError(e?.message || '설정 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto min-h-0">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div>
          <h2 className="text-gray-900 mb-2">챗봇 설정</h2>
          <p className="text-gray-600">
            AI 상담 챗봇의 동작 방식과 응답 기준을 설정합니다
          </p>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

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
                disabled={loading}
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
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* Response guidelines */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-gray-900 mb-4">2. 응답 기준 설정</h3>
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex gap-2">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-blue-800">
              입력하신 기준을 AI가 상담 시 참고합니다. 정책 원문을 길게 나열하기보다, 톤과 필수 안내만 적어주세요.
            </p>
          </div>
          <textarea
            value={companyPolicy}
            onChange={(e) => setCompanyPolicy(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={6}
            placeholder="응답 톤, 필수 안내, 정책 요약 등을 입력하세요"
            disabled={loading}
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
                disabled={loading}
              />
              <button
                onClick={handleAddCategory}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
              />
              <p className="mt-2 text-gray-600">
                AI가 처리할 수 없는 경우, "말씀해주신 내용 관련해서 추가적으로 확인 후 {responseWaitTime}분 이내에 답변드리도록 하겠습니다."라고 안내합니다
              </p>
            </div>

          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={loading || saving}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Save className="w-5 h-5" />
            {saving ? '저장 중...' : '설정 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
