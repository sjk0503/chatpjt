# 로컬 실행 가이드 (FastAPI + MySQL)

## 1) 환경 변수 설정

`backend/.env.example`을 복사해서 `backend/.env`를 만들고 값을 채워주세요.

```bash
cp backend/.env.example backend/.env
```

필수 확인값:
- `MYSQL_PASSWORD` (로컬 MySQL 비밀번호)
- `JWT_SECRET` (개발용이라도 임의 문자열로 변경 권장)

## 2) 의존성 설치(가상환경)

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -U pip
backend/.venv/bin/pip install -r backend/requirements.txt
```

> WebSocket 사용을 위해 `websockets`가 설치됩니다.

## 3) 관리자 계정 생성(최초 1회)

관리자 로그인은 DB에 `role='admin'` 사용자가 있어야 동작합니다.

```bash
python3 backend/scripts/create_admin.py --email admin@example.com --password admin --name Admin
```

## 4) 백엔드 실행

Vite 프록시가 `http://localhost:8000`으로 붙도록 설정되어 있습니다.

```bash
PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

헬스체크:
```bash
curl http://localhost:8000/health
```

## 5) 프론트 실행

```bash
npm -C frontend run dev
```

프론트는 `http://localhost:3000`에서 실행되며, `/api`와 `/ws`는 Vite가 백엔드로 프록시합니다.
