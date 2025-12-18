import { useState } from 'react';
import { CustomerLogin } from './components/customer/CustomerLogin';
import { CustomerChat } from './components/customer/CustomerChat';
import { AdminLogin } from './components/admin/AdminLogin';
import { AdminDashboard } from './components/admin/AdminDashboard';

export type UserRole = 'customer' | 'admin' | null;

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdminMode, setIsAdminMode] = useState(false);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  const toggleMode = () => {
    setIsAdminMode(!isAdminMode);
    setCurrentUser(null);
  };

  // Customer view
  if (!isAdminMode) {
    return (
      <div className="min-h-screen bg-gray-50">
        {!currentUser ? (
          <CustomerLogin onLogin={handleLogin} onSwitchToAdmin={() => setIsAdminMode(true)} />
        ) : (
          <CustomerChat user={currentUser} onLogout={handleLogout} />
        )}
      </div>
    );
  }

  // Admin view
  return (
    <div className="min-h-screen bg-gray-50">
      {!currentUser && (
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={toggleMode}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            고객 모드로 전환
          </button>
        </div>
      )}
      
      {!currentUser ? (
        <AdminLogin onLogin={handleLogin} />
      ) : (
        <AdminDashboard user={currentUser} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;