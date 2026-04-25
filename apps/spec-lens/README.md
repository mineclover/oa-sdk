# spec-lens UI

`@oa-sdk/spec-lens` 서버를 소비하는 브라우저 UI. React + Vite.

**전체 사용 가이드**: [`docs/spec-lens/README.md`](../../docs/spec-lens/README.md)

---

## 개발 실행

```bash
# 1. 백엔드 서버 먼저 시작 (별도 터미널, repo 루트에서)
pnpm exec tsx packages/spec-lens/src/cli.ts

# 2. UI dev server 시작
pnpm dev
# → http://localhost:5174  (/api/* 는 localhost:4891 으로 프록시)
```

---

## 프로덕션 빌드

```bash
pnpm build
# → dist/ 에 정적 파일 생성
# packages/spec-lens 서버가 dist/ 를 /ui/ 경로로 서빙
```

---

## 뷰 구성

| 뷰 | 경로 | 데이터 소스 |
|----|------|------------|
| **Timeline** | 기본 화면 | `GET /api/timeline` (Read Model) |
| **Diff** | Timeline 항목 클릭 | `GET /api/diff/:base/:head` |
| **Path Provenance** | 사이드바 ⚡ | `GET /api/paths` (Read Model) |
| **Fragment Graph** | 사이드바 ◎ | `GET /api/graph` |

---

## 스택

- React 19 + Vite 6
- TanStack Query — 서버 상태 관리 및 캐싱
- Monaco Editor (`@monaco-editor/react`) — Full YAML diff 탭
- D3.js — Fragment Graph 시각화
- `yaml` — 스펙 직렬화/역직렬화
