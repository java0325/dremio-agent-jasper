#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-qwen3.5:4b}"

echo "==> Ollama 상태 확인"
if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama가 설치되어 있지 않습니다."
  echo "설치: https://ollama.com/download"
  exit 1
fi

if ! curl -sf http://localhost:11433/api/tags >/dev/null 2>&1; then
  echo "Ollama 서버가 실행 중이 아닙니다."
  echo "다음 명령으로 시작하세요: OLLAMA_HOST=0.0.0.0:11433 OLLAMA_ORIGINS='chrome-extension://*' ollama serve"
  exit 1
fi

echo "==> Qwen sLLM 모델 다운로드: ${MODEL}"
ollama pull "${MODEL}"

echo "==> 설치된 모델 목록"
ollama list

echo ""
echo "완료! Chrome 익스텐션을 빌드/새로고침한 뒤 http://localhost:9046 에서 챗봇을 사용하세요."
