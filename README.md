# chatpjt · AI 상담 서비스

React+Vite 프론트와 FastAPI+MySQL 백엔드로 구성된 AI 상담 서비스입니다. 고객은 1:1 채팅을 통해 AI 응대를 받고, 관리자는 실시간 모니터링·개입·요약 관리 및 주문 조회를 수행합니다. WebSocket으로 실시간 메시지/상태를 전달합니다.

## 주요 기능
- 고객: 로그인, 활성 세션 조회/생성, 메시지·첨부 전송, 주문 조회
- 관리자: 활성/대기/완료 상담 목록, 상담원 개입/정보 제공/종료, 요약 조회, 챗봇 설정 관리, 주문 생성·조회·배송 상태 변경
- AI: GPT 오케스트레이터(`gpt-5-mini`)로 자동 응대/카테고리 분류/환불 정책 처리/자동 종료, pending·completed 요약 자동 생성, 주문 조회 툴콜
- 실시간: `/ws` WebSocket으로 `new_message`, `session_status_changed`, `session_completed`, `unread_count_updated` 등 이벤트 송신

## 프로젝트 구조
- `backend/`: FastAPI 앱 (`backend/app/main.py`), 라우트·서비스·AI 오케스트레이터, MySQL DB 연동, WebSocket `/ws`
- `frontend/`: React+Vite 앱, 고객/관리자 UI, WebSocket 클라이언트, 공통 API 유틸
- `AI.md`: GPT Function Calling/툴 설계 및 AI 정책
- `REQ.md`: 요구사항 목록
- `API.md`: 구현 API 요약

## 빠른 시작
사전 준비: Node.js, Python 3.x, MySQL (DB 명 기본 `ai3pjt`).

### 1) 백엔드
```bash
cp backend/.env.example backend/.env  # MYSQL_USER/MYSQL_PASSWORD/JWT_SECRET/GPT_API 등 채우기
python3 -m venv backend/.venv
backend/.venv/bin/pip install -U pip
backend/.venv/bin/pip install -r backend/requirements.txt

# 관리자 계정 생성
python3 backend/scripts/create_admin.py --email admin@example.com --password admin --name Admin

# 서버 실행 (기본: http://localhost:8000)
PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
헬스 체크: `curl http://localhost:8000/health`

### 2) 프론트엔드
```bash
npm -C frontend install
npm -C frontend run dev  # 기본 http://localhost:3000 (Vite 프록시로 /api, /ws → 8000)
```
환경 변수(옵션): `frontend/.env`에 `VITE_API_BASE_URL`, `VITE_WS_URL` 지정 가능(기본 동일 오리진).

## API 하이라이트
- 인증: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- 고객 채팅: `GET /api/chats/session`, `POST /api/chats/messages`, `POST /api/chats/upload`, `GET /api/chats/messages/{session_id}`
- 관리자 채팅: `GET /api/admin/chats/active|pending|completed`, `POST /api/admin/chats/{id}/takeover|provide-info|complete`, `GET /api/admin/chats/{id}/summary`
- 챗봇 설정: `GET/PUT /api/admin/chatbot/settings`
- 주문: 고객 `/api/orders`, 관리자 `/api/admin/orders`
- WebSocket: `/ws?token=...` (JWT 필요)
자세한 표는 `API.md` 참고.

## 테스트 계정 예시
- 관리자: `admin@example.com / admin` (스크립트로 생성)
- 고객: 최초 로그인 시 자동 생성, 예) `test1@example.com / test1234`

## 유용한 스크립트
- `backend/scripts/create_admin.py`: 관리자 계정 생성/갱신
- `backend/scripts/create_user.py`: 고객/관리자 생성/갱신

## 참고
- 업로드 경로: `backend/uploads/{sessionId}/...` (20MB 제한)
