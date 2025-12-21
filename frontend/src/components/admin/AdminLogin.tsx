import { useState, useEffect } from 'react';
import { User } from '../../App';
import { Shield, Monitor } from 'lucide-react';
import { apiCall } from '../../utils/api';

interface AdminLoginProps {
  onLogin: (user: User) => void;
}

export function AdminLogin({ onLogin }: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
          body: JSON.stringify({ email, password, role: 'admin' }),
        },
        { auth: false }
      );

      if (!res.data) throw new Error('로그인 응답이 올바르지 않습니다.');

      localStorage.setItem('token', res.data.token);
      onLogin(res.data.user);
    } catch (e: any) {
      setError(
        e?.message || '로그인에 실패했습니다. 이메일과 비밀번호를 다시 확인해주세요.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (isMobile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-900">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4">
            <Monitor className="w-8 h-8 text-gray-900" />
          </div>
          <h1 className="text-white mb-4">데스크탑에서만 이용 가능</h1>
          <p className="text-gray-400 mb-6">
            관리자 페이지는 데스크탑 환경에서만 사용할 수 있습니다.
            <br />
            PC 또는 노트북으로 접속해주세요.
          </p>
          <div className="inline-block px-4 py-2 bg-gray-800 text-gray-400 rounded-lg">
            최소 화면 너비: 1024px
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-900 rounded-2xl mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-gray-900 mb-2">관리자 로그인</h1>
          <p className="text-gray-600">
            상담 관리 시스템에 접근하려면 로그인이 필요합니다
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="admin-email" className="block text-gray-700 mb-2">
                관리자 이메일
              </label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="관리자 이메일을 입력하세요"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-gray-700 mb-2">
                비밀번호
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
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
              className="w-full bg-gray-900 text-white py-3 rounded-lg hover:bg-gray-800 transition-colors"
            >
              {loading ? '로그인 중...' : '관리자 로그인'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
