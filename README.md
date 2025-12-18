# chatpjt (로컬 테스트 실행 가이드)

이 프로젝트는 `frontend(React + Vite)`와 `backend(FastAPI + MySQL + WebSocket)`로 구성되어 있습니다.

## 사전 준비

- Node.js / npm
- Python 3.x
- MySQL (로컬에 `ai3pjt` DB 및 테이블 생성 완료 상태 가정)

> 주의: DB 비밀번호 같은 민감 정보는 `README.md`에 적지 않고 `backend/.env`에만 넣어주세요. (`.gitignore`에 `.env`는 제외되어 있습니다.)

---

## 1) 백엔드 실행 (FastAPI)

### 1-1. 환경 변수 설정

```bash
cp backend/.env.example backend/.env
```

`backend/.env`에서 아래 항목을 본인 로컬 환경에 맞게 수정:
- `MYSQL_USER` (기본: `root`)
- `MYSQL_PASSWORD` (본인 로컬 MySQL 비밀번호)
- `MYSQL_DB` (기본: `ai3pjt`)
- `JWT_SECRET` (아무 문자열로 변경 권장)

### 1-2. 가상환경/의존성 설치

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -U pip
backend/.venv/bin/pip install -r backend/requirements.txt
```

> WebSocket이 필요하므로 `backend/requirements.txt`에 `websockets`가 포함되어 있습니다. 만약 이미 설치했다면 위 명령을 다시 실행해주세요.

### 1-3. 관리자 계정 생성(최초 1회)

관리자 로그인은 DB에 `role='admin'` 계정이 있어야 합니다.

```bash
python3 backend/scripts/create_admin.py --email admin@example.com --password admin --name Admin
```

### 1-4. 백엔드 서버 실행

```bash
PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

헬스 체크:
```bash
curl http://localhost:8000/health
```

---

## 2) 프론트엔드 실행 (React)

Vite 개발 서버는 `http://localhost:3000`에서 실행됩니다.
또한 Vite 프록시로 `/api`, `/ws` 요청은 자동으로 `http://localhost:8000` 백엔드로 전달됩니다.

```bash
npm -C frontend run dev
```

---

## 테스트용 로그인 계정

### 관리자(Admin)
- 이메일: `admin@example.com`
- 비밀번호: `admin`
- 생성 방법: 위의 `create_admin.py` 실행 (이미 만들었다면 동일 이메일로 재실행 시 비밀번호가 갱신됩니다)

### 고객(Customer)
- 고객 로그인은 “처음 보는 이메일”로 로그인 시 자동으로 계정이 생성됩니다.
- 예시:
  - 이메일: `test1@example.com`
  - 비밀번호: `test1234`

> 고객 계정은 최초 로그인 시 DB에 저장되며, 이후에는 같은 이메일/비밀번호로 로그인해야 합니다.

---

## 테스트용 사용자 추가(스크립트)

### customer/admin 계정 생성/갱신: `create_user.py`

아래 스크립트는 `users` 테이블에 사용자를 직접 생성/갱신합니다.
이미 같은 이메일이 있으면 비밀번호/이름/role을 갱신합니다.

```bash
python3 backend/scripts/create_user.py --email test1@example.com --password test1234 --role customer --name 테스트유저1
```

관리자 계정도 생성 가능:

```bash
python3 backend/scripts/create_user.py --email admin@example.com --password admin --role admin --name Admin
```

> 참고: `users.email`은 UNIQUE라서 같은 이메일로 customer/admin을 동시에 만들 수는 없습니다(서로 다른 이메일 사용 필요).
