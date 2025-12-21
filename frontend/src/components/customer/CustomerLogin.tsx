import { useState } from 'react';
import { User } from '../../App';
import { MessageSquare } from 'lucide-react';
import { apiCall } from '../../utils/api';

interface CustomerLoginProps {
  onLogin: (user: User) => void;
  onSwitchToAdmin: () => void;
}

export function CustomerLogin({ onLogin, onSwitchToAdmin }: CustomerLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    try {
      setLoading(true);
      const res = await apiCall<{ user: User; token: string }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password, role: 'customer' }),
        },
        { auth: false }
      );

      if (!res.data) throw new Error('로그인 응답이 올바르지 않습니다.');

      localStorage.setItem('token', res.data.token);
      onLogin(res.data.user);
    } catch (e: any) {
      setError(e?.message || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoClick = () => {
    // Only allow easter egg on desktop (min-width: 1024px)
    if (window.innerWidth < 1024) return;
    
    const newCount = clickCount + 1;
    setClickCount(newCount);
    
    if (newCount >= 10) {
      onSwitchToAdmin();
      setClickCount(0);
    }
    
    // Reset counter after 2 seconds of inactivity
    setTimeout(() => {
      setClickCount(0);
    }, 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div 
            className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4"
            onClick={handleLogoClick}
          >
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-gray-900 mb-2">채팅 상담 서비스</h1>
          <p className="text-gray-600">
            회원 로그인 후 상담을 시작하실 수 있습니다
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-gray-700 mb-2">
                이메일
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="이메일을 입력하세요"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-gray-700 mb-2">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="비밀번호를 입력하세요"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>

            {/* Removed password recovery button */}
          </form>
        </div>
      </div>
    </div>
  );
}
