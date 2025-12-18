# 백엔드 로직 구현 명세서

## 📋 목차
1. [시스템 개요](#시스템-개요)
2. [데이터베이스 스키마](#데이터베이스-스키마)
3. [API 엔드포인트](#api-엔드포인트)
4. [WebSocket 이벤트](#websocket-이벤트)
5. [AI 통합](#ai-통합)
6. [하드코딩된 부분 및 변경 필요 사항](#하드코딩된-부분-및-변경-필요-사항)

---

## 시스템 개요

### 아키텍처
```
[프론트엔드] ←→ [REST API] ←→ [백엔드 서버] ←→ [데이터베이스]
                                ↓
                           [WebSocket]
                                ↓
                           [AI 서비스]
```

### 주요 기능
- **고객**: 1:1 채팅 상담 (AI 자동 응답)
- **관리자**: 실시간 상담 모니터링, 직접 개입, 상담 이력 관리, 챗봇 설정

---

## 데이터베이스 스키마

### 1. users (사용자)
```sql
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('customer', 'admin') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role (role)
);
```

### 2. chat_sessions (상담 세션)
```sql
CREATE TABLE chat_sessions (
  id VARCHAR(255) PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  status ENUM('active', 'pending', 'completed') DEFAULT 'active',
  handler_type ENUM('ai', 'agent') DEFAULT 'ai',
  assigned_agent_id VARCHAR(255), -- 상담원이 개입한 경우
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  pending_at TIMESTAMP NULL, -- 대기 상태로 전환된 시간
  completed_at TIMESTAMP NULL,
  duration_minutes INT, -- 완료 시 계산
  summary TEXT, -- AI 생성 요약
  FOREIGN KEY (customer_id) REFERENCES users(id),
  FOREIGN KEY (assigned_agent_id) REFERENCES users(id),
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_handler_type (handler_type),
  INDEX idx_completed_at (completed_at)
);
```

### 3. messages (메시지)
```sql
CREATE TABLE messages (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  sender_type ENUM('user', 'ai', 'agent') NOT NULL,
  sender_id VARCHAR(255), -- user 또는 agent의 id
  content TEXT NOT NULL,
  attachments JSON, -- 첨부파일 정보 배열
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  INDEX idx_session (session_id),
  INDEX idx_created_at (created_at),
  INDEX idx_is_read (is_read)
);
```

### 4. chatbot_settings (챗봇 설정)
```sql
CREATE TABLE chatbot_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by VARCHAR(255), -- 관리자 ID
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- 기본 설정값
INSERT INTO chatbot_settings (setting_key, setting_value) VALUES
('greeting', '안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?'),
('farewell', '상담이 완료되었습니다. 좋은 하루 되세요!'),
('company_policy', '환불은 구매 후 7일 이내에 가능합니다.\n배송비는 고객 부담입니다.\n제품 하자의 경우 무료 교환이 가능합니다.'),
('categories', '["주문 문의","환불 요청","기술 지원","계정 관리"]'),
('human_intervention_rules', '고객이 환불을 요청하는 경우\n기술적 문제 해결이 어려운 경우\n고객이 불만을 표현하는 경우'),
('response_wait_time', '5'),
('auto_close', 'true');
```

### 5. chat_session_metadata (상담 메타데이터)
```sql
CREATE TABLE chat_session_metadata (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(255) NOT NULL,
  unread_count INT DEFAULT 0, -- 관리자 미확인 메시지 수
  last_message TEXT,
  last_message_at TIMESTAMP,
  priority ENUM('high', 'medium', 'low') DEFAULT 'medium',
  wait_time_minutes INT DEFAULT 0, -- 대기 시간 (분)
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  INDEX idx_session (session_id)
);
```

---

## API 엔드포인트

### 🔐 인증 (Authentication)

#### POST /api/auth/login
고객 및 관리자 로그인
```json
// Request
{
  "email": "user@example.com",
  "password": "password123",
  "role": "customer" // or "admin"
}

// Response
{
  "success": true,
  "data": {
    "user": {
      "id": "user123",
      "email": "user@example.com",
      "name": "홍길동",
      "role": "customer"
    },
    "token": "jwt_token_here"
  }
}
```

#### POST /api/auth/logout
로그아웃
```json
// Request
{
  "token": "jwt_token_here"
}

// Response
{
  "success": true,
  "message": "로그아웃되었습니다."
}
```

#### GET /api/auth/me
현재 로그인한 사용자 정보
```json
// Headers: Authorization: Bearer {token}

// Response
{
  "success": true,
  "data": {
    "id": "user123",
    "email": "user@example.com",
    "name": "홍길동",
    "role": "customer"
  }
}
```

---

### 💬 채팅 메시지 (Messages)

#### GET /api/chats/session
고객의 현재 활성 세션 가져오기 또는 생성
```json
// Headers: Authorization: Bearer {token}

// Response - 기존 세션이 있는 경우
{
  "success": true,
  "data": {
    "session": {
      "id": "session123",
      "customer_id": "user123",
      "category": "주문 문의",
      "status": "active",
      "handler_type": "ai",
      "started_at": "2025-12-18T10:00:00Z"
    },
    "messages": [
      {
        "id": "msg1",
        "session_id": "session123",
        "sender_type": "ai",
        "content": "안녕하세요! 채팅 상담 서비스입니다.",
        "created_at": "2025-12-18T10:00:00Z"
      }
    ]
  }
}

// Response - 새 세션 생성
{
  "success": true,
  "data": {
    "session": {
      "id": "session456",
      "customer_id": "user123",
      "status": "active",
      "handler_type": "ai",
      "started_at": "2025-12-18T11:00:00Z"
    },
    "messages": [
      {
        "id": "msg_greeting",
        "sender_type": "ai",
        "content": "안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?",
        "created_at": "2025-12-18T11:00:00Z"
      }
    ]
  }
}
```

#### POST /api/chats/messages
메시지 전송
```json
// Request
{
  "session_id": "session123",
  "content": "주문한 상품이 언제 도착하나요?",
  "attachments": ["file1.pdf"] // optional
}

// Response
{
  "success": true,
  "data": {
    "message": {
      "id": "msg123",
      "session_id": "session123",
      "sender_type": "user",
      "sender_id": "user123",
      "content": "주문한 상품이 언제 도착하나요?",
      "created_at": "2025-12-18T10:01:00Z"
    }
  }
}

// AI 응답은 WebSocket을 통해 실시간 전달됨
```

#### GET /api/chats/messages/:sessionId
특정 세션의 모든 메시지 조회
```json
// Response
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg1",
        "sender_type": "ai",
        "content": "안녕하세요!",
        "created_at": "2025-12-18T10:00:00Z"
      },
      // ...
    ]
  }
}
```

---

### 🎯 관리자 - 상담 관리 (Admin Chat Management)

#### GET /api/admin/chats/active
상담 중인 채팅 목록
```json
// Query params: ?category=all&search=

// Response
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "session123",
        "customer_id": "user123",
        "customer_name": "user1@example.com",
        "category": "주문 문의",
        "last_message": "주문한 상품이 언제 도착하나요?",
        "timestamp": "2025-12-18T10:05:00Z",
        "status": "ai",
        "unread": 2
      }
    ]
  }
}
```

#### GET /api/admin/chats/pending
처리 대기 중인 채팅 목록
```json
// Query params: ?category=all&search=

// Response
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "session456",
        "customer_id": "user456",
        "customer_name": "user4@example.com",
        "category": "환불 요청",
        "issue": "고객이 환불 정책 예외 사항을 요청하고 있습니다",
        "wait_time": 45,
        "priority": "high"
      }
    ]
  }
}
```

#### GET /api/admin/chats/completed
완료된 채팅 목록
```json
// Query params: ?category=all&handler=all&dateRange=all&search=

// Response
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "session789",
        "customer_id": "user789",
        "customer_name": "user7@example.com",
        "category": "주문 문의",
        "handled_by": "AI",
        "duration": 8,
        "completed_at": "2025-12-18T08:00:00Z",
        "summary": "배송 조회 문의 - 정상 처리 완료"
      }
    ]
  }
}
```

#### POST /api/admin/chats/:sessionId/takeover
관리자가 직접 상담 개입
```json
// Request
{
  "agent_id": "admin123"
}

// Response
{
  "success": true,
  "message": "상담원 모드로 전환되었습니다."
}

// WebSocket으로 실시간 상태 업데이트
```

#### POST /api/admin/chats/:sessionId/provide-info
AI에게 정보 제공 (대기 중인 채팅)
```json
// Request
{
  "info": "고객의 주문번호는 123456이며, 배송 예정일은 12월 20일입니다."
}

// Response
{
  "success": true,
  "message": "AI에게 정보를 전달했습니다. AI가 고객에게 응답합니다."
}
```

#### POST /api/admin/chats/:sessionId/complete
상담 종료
```json
// Request
{
  "summary": "배송 조회 문의 - 정상 처리 완료"
}

// Response
{
  "success": true,
  "message": "상담이 종료되었습니다."
}
```

#### GET /api/admin/chats/:sessionId/summary
AI 요약 생성
```json
// Response
{
  "success": true,
  "data": {
    "summary": {
      "core_summary": "고객이 주문한 상품의 배송 상태를 문의하고 있습니다. 주문번호 확인이 필요합니다.",
      "current_issues": [
        "주문번호 미확인",
        "배송 조회 대기"
      ],
      "customer_info": {
        "email": "user1@example.com",
        "started_at": "2025-12-18T10:00:00Z"
      }
    }
  }
}
```

---

### ⚙️ 챗봇 설정 (Chatbot Settings)

#### GET /api/admin/chatbot/settings
현재 챗봇 설정 조회
```json
// Response
{
  "success": true,
  "data": {
    "greeting": "안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?",
    "farewell": "상담이 완료되었습니다. 좋은 하루 되세요!",
    "company_policy": "환불은 구매 후 7일 이내에 가능합니다...",
    "categories": ["주문 문의", "환불 요청", "기술 지원", "계정 관리"],
    "human_intervention_rules": "고객이 환불을 요청하는 경우...",
    "response_wait_time": 5,
    "auto_close": true
  }
}
```

#### PUT /api/admin/chatbot/settings
챗봇 설정 저장 (한 번에 모든 설정 저장)
```json
// Request
{
  "greeting": "안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?",
  "farewell": "상담이 완료되었습니다. 좋은 하루 되세요!",
  "company_policy": "환불은 구매 후 7일 이내에 가능합니다.\n배송비는 고객 부담입니다.",
  "categories": ["주문 문의", "환불 요청", "기술 지원", "계정 관리", "기타"],
  "human_intervention_rules": "고객이 환불을 요청하는 경우\n기술적 문제 해결이 어려운 경우",
  "response_wait_time": 5,
  "auto_close": true
}

// Response
{
  "success": true,
  "message": "설정이 저장되었습니다."
}
```

---

## WebSocket 이벤트

### 연결
```javascript
const ws = new WebSocket('ws://your-backend-url/ws?token=jwt_token');
```

### 고객 ↔ 백엔드

#### 클라이언트 → 서버
```json
// 메시지 전송
{
  "type": "send_message",
  "data": {
    "session_id": "session123",
    "content": "안녕하세요",
    "attachments": []
  }
}

// 타이핑 중 표시
{
  "type": "typing",
  "data": {
    "session_id": "session123"
  }
}
```

#### 서버 → 클라이언트
```json
// 새 메시지 수신
{
  "type": "new_message",
  "data": {
    "message": {
      "id": "msg123",
      "sender_type": "ai",
      "content": "네, 무엇을 도와드릴까요?",
      "created_at": "2025-12-18T10:01:00Z"
    }
  }
}

// 상담원 연결됨
{
  "type": "agent_connected",
  "data": {
    "session_id": "session123",
    "message": "상담원이 연결되었습니다."
  }
}

// 상담 종료
{
  "type": "session_completed",
  "data": {
    "session_id": "session123",
    "message": "상담이 완료되었습니다. 좋은 하루 되세요!"
  }
}
```

### 관리자 ↔ 백엔드

#### 클라이언트 → 서버
```json
// 관리자 메시지 전송
{
  "type": "agent_message",
  "data": {
    "session_id": "session123",
    "content": "주문번호를 확인해주시겠어요?"
  }
}

// 채팅 목록 구독
{
  "type": "subscribe_chats",
  "data": {
    "chat_type": "active" // or "pending", "completed"
  }
}
```

#### 서버 → 클라이언트
```json
// 새 채팅 세션 알림
{
  "type": "new_chat_session",
  "data": {
    "session": {
      "id": "session999",
      "customer_name": "user99@example.com",
      "category": "주문 문의",
      "started_at": "2025-12-18T10:00:00Z"
    }
  }
}

// 메시지 수신 (고객이 보낸 메시지)
{
  "type": "customer_message",
  "data": {
    "session_id": "session123",
    "message": {
      "id": "msg456",
      "content": "주문번호는 123456입니다.",
      "created_at": "2025-12-18T10:02:00Z"
    }
  }
}

// 상담 상태 변경
{
  "type": "session_status_changed",
  "data": {
    "session_id": "session123",
    "status": "pending", // active, pending, completed
    "handler_type": "agent" // ai, agent
  }
}

// 미확인 메시지 수 업데이트
{
  "type": "unread_count_updated",
  "data": {
    "session_id": "session123",
    "unread_count": 3
  }
}
```

---

## AI 통합

### AI 서비스 연동 방식

#### 1. 메시지 처리 플로우
```
고객 메시지 수신
    ↓
카테고리 자동 분류 (AI)
    ↓
회사 정책 참조하여 응답 생성 (AI)
    ↓
사람 개입 필요 여부 판단
    ↓
[AI 응답 가능] → 고객에게 응답 전송
[사람 개입 필요] → 대기 상태로 전환 + 관리자 알림
```

#### 2. AI API 호출 예시
```json
// POST /ai/process-message
{
  "session_id": "session123",
  "message": "주문을 취소하고 싶어요",
  "context": {
    "company_policy": "환불은 구매 후 7일 이내에 가능합니다...",
    "chat_history": [
      {
        "sender": "ai",
        "content": "안녕하세요! 무엇을 도와드릴까요?"
      },
      {
        "sender": "user",
        "content": "주문을 취소하고 싶어요"
      }
    ],
    "human_intervention_rules": "고객이 환불을 요청하는 경우..."
  }
}

// Response
{
  "category": "환불 요청",
  "needs_human": true,
  "reason": "고객이 환불을 요청하여 사람 개입이 필요합니다.",
  "suggested_response": "말씀해주신 내용 관련해서 추가적으로 확인 후 5분 이내에 답변드리도록 하겠습니다.",
  "wait_time_minutes": 5
}

// OR (AI가 직접 응답 가능한 경우)
{
  "category": "주문 문의",
  "needs_human": false,
  "response": "주문번호를 알려주시면 배송 상태를 확인해드리겠습니다.",
  "confidence": 0.95
}
```

#### 3. AI 요약 생성
```json
// POST /ai/generate-summary
{
  "session_id": "session123",
  "messages": [
    // 전체 대화 내역
  ]
}

// Response
{
  "core_summary": "고객이 주문한 상품의 배송 상태를 문의하고 있습니다.",
  "current_issues": [
    "주문번호 미확인",
    "배송 조회 대기"
  ],
  "recommended_actions": [
    "주문번호 확인 요청",
    "배송 조회 시스템 확인"
  ]
}
```

---

## 하드코딩된 부분 및 변경 필요 사항

### 🔴 즉시 변경 필요 (Critical)

#### 1. 고객 로그인 (`/components/customer/CustomerLogin.tsx`)
**현재 (라인 24-29):**
```typescript
// Mock login
onLogin({
  id: '1',
  email: email,
  role: 'customer',
  name: email.split('@')[0],
});
```

**변경 후:**
```typescript
try {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'customer' })
  });
  
  const data = await response.json();
  
  if (data.success) {
    localStorage.setItem('token', data.data.token);
    onLogin(data.data.user);
  } else {
    setError(data.message || '로그인에 실패했습니다.');
  }
} catch (error) {
  setError('서버 연결에 실패했습니다.');
}
```

#### 2. 관리자 로그인 (`/components/admin/AdminLogin.tsx`)
**현재 (라인 35-44):**
```typescript
// Mock admin login
if (email === 'admin@example.com' && password === 'admin') {
  onLogin({
    id: 'admin1',
    email: email,
    role: 'admin',
    name: 'Admin',
  });
} else {
  setError('이메일 또는 비밀번호가 올바르지 않습니다.');
}
```

**변경 후:**
```typescript
try {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'admin' })
  });
  
  const data = await response.json();
  
  if (data.success) {
    localStorage.setItem('token', data.data.token);
    onLogin(data.data.user);
  } else {
    setError(data.message || '로그인에 실패했습니다.');
  }
} catch (error) {
  setError('서버 연결에 실패했습니다.');
}
```

#### 3. 고객 채팅 (`/components/customer/CustomerChat.tsx`)

**현재 (라인 19-26):**
```typescript
const [messages, setMessages] = useState<Message[]>([
  {
    id: '1',
    sender: 'ai',
    content: '안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?',
    timestamp: new Date(),
  },
]);
```

**변경 후:**
```typescript
const [messages, setMessages] = useState<Message[]>([]);
const [sessionId, setSessionId] = useState<string | null>(null);
const wsRef = useRef<WebSocket | null>(null);

useEffect(() => {
  // 1. 세션 가져오기 또는 생성
  const initSession = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/chats/session', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await response.json();
      if (data.success) {
        setSessionId(data.data.session.id);
        setMessages(data.data.messages);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };
  
  // 2. WebSocket 연결
  const connectWebSocket = () => {
    const token = localStorage.getItem('token');
    const ws = new WebSocket(`ws://your-backend-url/ws?token=${token}`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'new_message') {
        setMessages(prev => [...prev, data.data.message]);
      } else if (data.type === 'agent_connected') {
        // 상담원 연결 알림 처리
      } else if (data.type === 'session_completed') {
        // 상담 종료 처리
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      // 재연결 로직
      setTimeout(connectWebSocket, 3000);
    };
    
    wsRef.current = ws;
  };
  
  initSession();
  connectWebSocket();
  
  return () => {
    wsRef.current?.close();
  };
}, []);
```

**현재 (라인 40-65) - 메시지 전송:**
```typescript
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
```

**변경 후:**
```typescript
const handleSend = async () => {
  if (!inputText.trim() || !sessionId) return;

  const messageContent = inputText;
  setInputText('');

  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/chats/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        session_id: sessionId,
        content: messageContent
      })
    });

    const data = await response.json();
    
    if (data.success) {
      // 사용자 메시지를 즉시 UI에 추가
      setMessages(prev => [...prev, data.data.message]);
      
      // AI 응답은 WebSocket을 통해 수신됨
    }
  } catch (error) {
    console.error('Failed to send message:', error);
    setError('메시지 전송에 실패했습니다.');
  }
};
```

#### 4. 관리자 - 상담 중인 채팅 (`/components/admin/ActiveChats.tsx`)

**현재 (라인 15-46) - Mock 데이터:**
```typescript
const mockChats: ChatSession[] = [
  {
    id: '1',
    customerId: 'user1',
    customerName: 'user1@example.com',
    // ...
  },
];
```

**변경 후:**
```typescript
const [chats, setChats] = useState<ChatSession[]>([]);
const wsRef = useRef<WebSocket | null>(null);

useEffect(() => {
  // 1. 채팅 목록 조회
  const fetchChats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/admin/chats/active?category=${filterCategory}&search=${searchQuery}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      const data = await response.json();
      if (data.success) {
        setChats(data.data.chats);
      }
    } catch (error) {
      console.error('Failed to fetch chats:', error);
    }
  };
  
  // 2. WebSocket 연결 (실시간 업데이트)
  const connectWebSocket = () => {
    const token = localStorage.getItem('token');
    const ws = new WebSocket(`ws://your-backend-url/ws?token=${token}`);
    
    ws.onopen = () => {
      // 채팅 목록 구독
      ws.send(JSON.stringify({
        type: 'subscribe_chats',
        data: { chat_type: 'active' }
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'new_chat_session') {
        setChats(prev => [data.data.session, ...prev]);
      } else if (data.type === 'customer_message') {
        // 해당 세션의 미확인 메시지 수 업데이트
        setChats(prev => prev.map(chat => 
          chat.id === data.data.session_id
            ? { ...chat, unread: chat.unread + 1 }
            : chat
        ));
      } else if (data.type === 'session_status_changed') {
        // 상담 상태 변경 (pending, completed 등으로 이동)
        setChats(prev => prev.filter(chat => chat.id !== data.data.session_id));
      }
    };
    
    wsRef.current = ws;
  };
  
  fetchChats();
  connectWebSocket();
  
  return () => {
    wsRef.current?.close();
  };
}, [filterCategory, searchQuery]);
```

**현재 (라인 95-97) - 상담원 개입:**
```typescript
const handleTakeOver = () => {
  setAgentMode(true);
};
```

**변경 후:**
```typescript
const handleTakeOver = async () => {
  if (!selectedChat) return;
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/admin/chats/${selectedChat.id}/takeover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ agent_id: user.id })
    });
    
    const data = await response.json();
    
    if (data.success) {
      setAgentMode(true);
      // WebSocket을 통해 실시간 상태 업데이트 수신
    }
  } catch (error) {
    console.error('Failed to take over:', error);
  }
};
```

**현재 (라인 99-103) - 메시지 전송:**
```typescript
const handleSendMessage = () => {
  if (!agentMessage.trim()) return;
  // In a real app, send message to customer
  setAgentMessage('');
};
```

**변경 후:**
```typescript
const handleSendMessage = async () => {
  if (!agentMessage.trim() || !selectedChat) return;
  
  const messageContent = agentMessage;
  setAgentMessage('');
  
  try {
    // WebSocket을 통해 메시지 전송
    wsRef.current?.send(JSON.stringify({
      type: 'agent_message',
      data: {
        session_id: selectedChat.id,
        content: messageContent
      }
    }));
    
    // 또는 REST API 사용
    const token = localStorage.getItem('token');
    await fetch('/api/chats/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        session_id: selectedChat.id,
        content: messageContent
      })
    });
  } catch (error) {
    console.error('Failed to send message:', error);
  }
};
```

#### 5. 관리자 - 처리 대기 중인 채팅 (`/components/admin/PendingChats.tsx`)

**현재 (라인 14-42) - Mock 데이터:**
```typescript
const mockPendingChats: PendingChat[] = [
  {
    id: '1',
    customerId: 'user4',
    // ...
  },
];
```

**변경 후:**
```typescript
const [chats, setChats] = useState<PendingChat[]>([]);

useEffect(() => {
  const fetchPendingChats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/admin/chats/pending?category=${filterCategory}&search=${searchQuery}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      const data = await response.json();
      if (data.success) {
        setChats(data.data.chats);
      }
    } catch (error) {
      console.error('Failed to fetch pending chats:', error);
    }
  };
  
  fetchPendingChats();
}, [filterCategory, searchQuery]);
```

**현재 (라인 61-65) - 정보 제공:**
```typescript
const handleProvideInfo = () => {
  if (!responseText.trim()) return;
  alert('AI에게 정보를 전달했습니다. AI가 고객에게 응답합니다.');
  setResponseText('');
};
```

**변경 후:**
```typescript
const handleProvideInfo = async () => {
  if (!responseText.trim() || !selectedChat) return;
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/admin/chats/${selectedChat.id}/provide-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ info: responseText })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('AI에게 정보를 전달했습니다. AI가 고객에게 응답합니다.');
      setResponseText('');
      // 채팅 목록 갱신
      fetchPendingChats();
    }
  } catch (error) {
    console.error('Failed to provide info:', error);
  }
};
```

#### 6. 관리자 - 완료된 채팅 (`/components/admin/CompletedChats.tsx`)

**현재 (라인 15-66) - Mock 데이터:**
```typescript
const mockCompletedChats: CompletedChat[] = [
  {
    id: '1',
    customerId: 'user7',
    // ...
  },
];
```

**변경 후:**
```typescript
const [chats, setChats] = useState<CompletedChat[]>([]);

useEffect(() => {
  const fetchCompletedChats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/admin/chats/completed?category=${filterCategory}&handler=${filterHandler}&dateRange=${dateRange}&search=${searchQuery}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      
      const data = await response.json();
      if (data.success) {
        setChats(data.data.chats);
      }
    } catch (error) {
      console.error('Failed to fetch completed chats:', error);
    }
  };
  
  fetchCompletedChats();
}, [filterCategory, filterHandler, dateRange, searchQuery]);
```

#### 7. 챗봇 설정 (`/components/admin/ChatbotSettings.tsx`)

**현재 (라인 5-21) - 로컬 상태만:**
```typescript
const [greeting, setGreeting] = useState('안녕하세요! 채팅 상담 서비스입니다. 무엇을 도와드릴까요?');
const [farewell, setFarewell] = useState('상담이 완료되었습니다. 좋은 하루 되세요!');
// ...
```

**변경 후:**
```typescript
const [greeting, setGreeting] = useState('');
const [farewell, setFarewell] = useState('');
const [companyPolicy, setCompanyPolicy] = useState('');
const [categories, setCategories] = useState<string[]>([]);
const [humanInterventionRules, setHumanInterventionRules] = useState('');
const [responseWaitTime, setResponseWaitTime] = useState('5');
const [autoClose, setAutoClose] = useState(true);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/chatbot/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setGreeting(data.data.greeting);
        setFarewell(data.data.farewell);
        setCompanyPolicy(data.data.company_policy);
        setCategories(data.data.categories);
        setHumanInterventionRules(data.data.human_intervention_rules);
        setResponseWaitTime(data.data.response_wait_time.toString());
        setAutoClose(data.data.auto_close);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };
  
  fetchSettings();
}, []);
```

**현재 (라인 34-36) - 설정 저장:**
```typescript
const handleSaveSettings = () => {
  alert('설정이 저장되었습니다.');
};
```

**변경 후:**
```typescript
const handleSaveSettings = async () => {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/admin/chatbot/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        greeting,
        farewell,
        company_policy: companyPolicy,
        categories,
        human_intervention_rules: humanInterventionRules,
        response_wait_time: parseInt(responseWaitTime),
        auto_close: autoClose
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('설정이 저장되었습니다.');
    } else {
      alert('설정 저장에 실패했습니다.');
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert('설정 저장 중 오류가 발생했습니다.');
  }
};
```

---

### 🟡 추가 고려사항 (Important)

#### 1. 환경 변수 설정
프론트엔드에 백엔드 URL을 하드코딩하지 말고 환경 변수로 관리:

```typescript
// config.ts
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
```

#### 2. API 클라이언트 유틸리티
반복적인 fetch 코드를 줄이기 위한 유틸리티 함수:

```typescript
// utils/api.ts
export async function apiCall(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers
    }
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.message || 'API 요청 실패');
  }
  
  return data;
}
```

#### 3. WebSocket 관리 훅
재사용 가능한 WebSocket 훅:

```typescript
// hooks/useWebSocket.ts
export function useWebSocket(onMessage: (data: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    const token = localStorage.getItem('token');
    const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);
    
    ws.onopen = () => console.log('WebSocket connected');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };
    ws.onerror = (error) => console.error('WebSocket error:', error);
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setTimeout(() => {
        // 재연결 로직
      }, 3000);
    };
    
    wsRef.current = ws;
    
    return () => ws.close();
  }, []);
  
  const sendMessage = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };
  
  return { sendMessage };
}
```

#### 4. 에러 처리 및 로딩 상태
모든 API 호출에 에러 처리와 로딩 상태 추가:

```typescript
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

try {
  setLoading(true);
  setError(null);
  // API 호출
} catch (error) {
  setError(error.message);
} finally {
  setLoading(false);
}
```

#### 5. 인증 토큰 만료 처리
API 응답이 401이면 자동 로그아웃:

```typescript
if (response.status === 401) {
  localStorage.removeItem('token');
  window.location.href = '/login';
}
```

---

## 체크리스트

### 백엔드 구현
- [ ] 데이터베이스 스키마 생성
- [ ] 인증 API 구현
- [ ] 채팅 메시지 API 구현
- [ ] 관리자 상담 관리 API 구현
- [ ] 챗봇 설정 API 구현
- [ ] WebSocket 서버 구현
- [ ] AI 서비스 통합

### 프론트엔드 수정
- [ ] CustomerLogin.tsx - 로그인 API 연동
- [ ] AdminLogin.tsx - 로그인 API 연동
- [ ] CustomerChat.tsx - 채팅 API 및 WebSocket 연동
- [ ] ActiveChats.tsx - 상담 관리 API 및 WebSocket 연동
- [ ] PendingChats.tsx - 대기 채팅 API 연동
- [ ] CompletedChats.tsx - 완료 채팅 API 연동
- [ ] ChatbotSettings.tsx - 설정 API 연동
- [ ] 환경 변수 설정
- [ ] API 클라이언트 유틸리티 구현
- [ ] WebSocket 훅 구현
- [ ] 에러 처리 및 로딩 상태 추가

---

## 참고 사항

1. **보안**: 
   - JWT 토큰은 HttpOnly 쿠키로 저장하는 것이 더 안전합니다
   - CORS 설정 필수
   - API Rate Limiting 구현

2. **성능**:
   - 채팅 메시지는 페이지네이션 구현
   - 이미지/파일 업로드는 CDN 사용
   - WebSocket 재연결 로직 구현

3. **확장성**:
   - Redis를 사용한 WebSocket 스케일링
   - 메시지 큐 (RabbitMQ, Kafka) 사용 고려
   - AI 서비스는 비동기 처리

4. **모니터링**:
   - 채팅 응답 시간 추적
   - AI vs 상담원 처리 비율
   - 고객 만족도 측정
