# Dremio Chat Chrome Extension + Qwen3.5 sLLM

`localhost:9046` Dremio 페이지에서 챗봇 UI를 제공하고, **Ollama로 로컬 실행한 Qwen3.5 sLLM** 과 대화합니다.

## 아키텍처

```
[Dremio 페이지] ── content script (React UI)
        │
        └── chrome.runtime.connect
                │
        [background service worker]
                │
                └── fetch → Ollama API (localhost:11433)
                                    │
                              Qwen3.5 sLLM
```

- Content script는 Shadow DOM에 UI를 렌더링
- Background worker가 Ollama API를 호출 (CORS 우회)
- 스트리밍 응답을 실시간으로 채팅 패널에 표시

## 사전 준비

### 1. Ollama 설치 및 Qwen3.5 모델 다운로드

```bash
# Ollama 설치: https://ollama.com/download
# Ollama 앱 실행 후:

cd dremio-chat-extension
chmod +x scripts/setup-ollama.sh
./scripts/setup-ollama.sh          # 기본: qwen3.5:4b
./scripts/setup-ollama.sh qwen3.5:2b   # 더 가벼운 모델
```

| 모델 | 용량 | 권장 환경 |
|------|------|-----------|
| `qwen3.5:0.8b` | ~1 GB | CPU only |
| `qwen3.5:2b` | ~2.7 GB | 8GB RAM |
| `qwen3.5:4b` | ~3.4 GB | 8GB VRAM / 16GB RAM (기본값) |
| `qwen3.5:9b` | ~6.6 GB | 16GB VRAM |

### 2. 익스텐션 빌드

```bash
npm install
npm run build
```

### 3. Chrome에 로드

1. `chrome://extensions`
2. **개발자 모드** ON
3. **압축해제된 확장 프로그램을 로드합니다** → `dist` 폴더 선택

### 4. 사용

1. Ollama 앱 실행 (또는 `ollama serve`)
2. `http://localhost:9046` 접속
3. 좌측 하단 챗봇 버튼 클릭
4. 헤더에 `Qwen qwen3.5:4b` 연결 상태 확인 후 대화

## 모델 변경

`src/shared/config.ts` 에서 `DEFAULT_QWEN_MODEL` 수정:

```ts
export const DEFAULT_QWEN_MODEL = "qwen3.5:2b";
```

수정 후 `npm run build` → Chrome 익스텐션 새로고침.

## 개발

```bash
npm run dev
```

코드 수정 후 `chrome://extensions`에서 익스텐션 새로고침 + Dremio 페이지 새로고침.

## 트러블슈팅

| 증상 | 해결 |
|------|------|
| "Ollama 연결 안 됨" | Ollama 앱 실행 확인 |
| "모델이 없습니다" | `ollama pull qwen3.5:4b` |
| 응답이 느림 | 더 작은 모델 사용 (`qwen3.5:2b`) |
| UI가 안 보임 | URL이 `localhost:9046` 인지 확인 |

## 파일 구조

```
src/
├── background/index.ts       # Ollama API 프록시 + 스트리밍
├── shared/config.ts          # 모델명, 시스템 프롬프트
├── shared/types.ts
└── content/
    ├── hooks/useQwenChat.ts  # 채팅 상태 관리
    ├── services/qwenClient.ts
    └── components/ChatPanel.tsx
```
