import { useState, useRef, useEffect } from 'react';
import { User } from '../../App';
import { Send, Paperclip, Bot, User as UserIcon, LogOut } from 'lucide-react';

interface Message {
  id: string;
  sender: 'user' | 'ai' | 'agent';
  content: string;
  timestamp: Date;
  attachments?: string[];
}

interface CustomerChatProps {
  user: User;
  onLogout: () => void;
}

export function CustomerChat({ user, onLogout }: CustomerChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'ai',
      content: '안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isAgentMode, setIsAgentMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      content: inputText,
      timestamp: new Date(),
    };

    setMessages([...messages, newMessage]);
    setInputText('');

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        sender: isAgentMode ? 'agent' : 'ai',
        content: isAgentMode
          ? '상담원이 확인 중입니다. 잠시만 기다려주세요.'
          : '문의사항을 확인했습니다. 추가로 필요한 정보가 있으신가요?',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileName = files[0].name;
      const fileMessage: Message = {
        id: Date.now().toString(),
        sender: 'user',
        content: `파일 첨부: ${fileName}`,
        timestamp: new Date(),
        attachments: [fileName],
      };
      setMessages([...messages, fileMessage]);
    }
  };

  const toggleAgentMode = () => {
    setIsAgentMode(!isAgentMode);
    const statusMessage: Message = {
      id: Date.now().toString(),
      sender: 'ai',
      content: !isAgentMode
        ? '상담원이 연결되었습니다.'
        : 'AI 상담으로 전환되었습니다.',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, statusMessage]);
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
                    : message.sender === 'agent'
                    ? 'bg-green-600'
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
          {isAgentMode && (
            <div className="mb-3 px-4 py-2 bg-green-50 border border-green-200 text-green-800 rounded-lg">
              상담원이 응대 중입니다
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleFileClick}
              className="p-3 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title="파일 첨부"
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
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
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