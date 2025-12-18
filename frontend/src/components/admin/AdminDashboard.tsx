import { useState, useEffect } from 'react';
import { User } from '../../App';
import { MessageSquare, Clock, CheckCircle, Settings, LogOut, Monitor } from 'lucide-react';
import { ActiveChats } from './ActiveChats';
import { PendingChats } from './PendingChats';
import { CompletedChats } from './CompletedChats';
import { ChatbotSettings } from './ChatbotSettings';

interface AdminDashboardProps {
  user: User;
  onLogout: () => void;
}

type TabType = 'active' | 'pending' | 'completed' | 'settings';

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const tabs = [
    { id: 'active' as TabType, label: '상담 중인 채팅', icon: MessageSquare },
    { id: 'pending' as TabType, label: '처리 대기 중인 채팅', icon: Clock },
    { id: 'completed' as TabType, label: '상담 완료된 채팅', icon: CheckCircle },
    { id: 'settings' as TabType, label: '챗봇 설정', icon: Settings },
  ];

  if (isMobile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-900">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4">
            <Monitor className="w-8 h-8 text-gray-900" />
          </div>
          <h1 className="text-white mb-4">데스크탑에서만 이용 가능</h1>
          <p className="text-gray-400 mb-6">
            관리자 대시보드는 데스크탑 환경에서만 사용할 수 있습니다.
            <br />
            PC 또는 노트북으로 접속해주세요.
          </p>
          <div className="inline-block px-4 py-2 bg-gray-800 text-gray-400 rounded-lg mb-6">
            최소 화면 너비: 1024px
          </div>
          <button
            onClick={onLogout}
            className="px-6 py-3 bg-white text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6">
          <h1 className="text-white mb-1">상담 관리 시스템</h1>
          <p className="text-gray-400">{user.email}</p>
        </div>

        <nav className="flex-1 px-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-gray-900'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>로그아웃</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 h-full overflow-hidden bg-gray-50">
        {activeTab === 'active' && (
          <div className="h-full">
            <ActiveChats user={user} />
          </div>
        )}
        {activeTab === 'pending' && (
          <div className="h-full">
            <PendingChats user={user} />
          </div>
        )}
        {activeTab === 'completed' && (
          <div className="h-full">
            <CompletedChats />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="h-full">
            <ChatbotSettings />
          </div>
        )}
      </div>
    </div>
  );
}
