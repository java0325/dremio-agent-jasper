#!/usr/bin/env zsh
# ─────────────────────────────────────────────
#  start.sh  –  Dremio Agent 환경 시작
#  관리 대상: dremio-agent(9046), sample-postgres(5431), Ollama(11433)
#  dremio-oss 는 완전히 독립 (건드리지 않음)
# ─────────────────────────────────────────────

DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
SCRIPT_DIR="${0:A:h}"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

ok()   { echo "${GREEN}[✓]${NC} $1"; }
warn() { echo "${YELLOW}[!]${NC} $1"; }
fail() { echo "${RED}[✗]${NC} $1"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dremio Agent 환경 시작"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Docker Desktop 확인 ─────────────────
if ! $DOCKER info &>/dev/null; then
  warn "Docker Desktop 이 실행 중이 아닙니다. 시작합니다..."
  open -a Docker
  echo "  Docker 준비 대기 중..."
  for i in {1..30}; do
    sleep 2
    $DOCKER info &>/dev/null && break
    [[ $i -eq 30 ]] && { fail "Docker 시작 실패. 수동으로 확인해 주세요."; exit 1; }
  done
fi
ok "Docker Desktop 실행 중"

# ── 2. docker-compose 로 서비스 기동 ──────
echo ""
warn "sample-postgres(5431) + dremio-agent(9046) 기동 중..."
cd "${SCRIPT_DIR}" && $DOCKER compose up -d 2>&1 | grep -E "Started|Created|Running|Error|Warning" || true

# 상태 확인
for svc in sample-postgres dremio-agent; do
  CSTATE=$($DOCKER inspect -f '{{.State.Status}}' "$svc" 2>/dev/null)
  if [[ "$CSTATE" == "running" ]]; then
    ok "${svc} 실행 중"
  else
    fail "${svc} 시작 실패 (상태: ${CSTATE:-없음})"
  fi
done

# ── 3. Ollama 시작 (포트 11433) ────────────
if pgrep -x ollama &>/dev/null; then
  # 이미 실행 중인 경우 포트 확인
  if curl -sf http://localhost:11433/api/tags &>/dev/null; then
    ok "Ollama 이미 실행 중 (포트 11433)"
  else
    warn "Ollama 가 다른 포트에서 실행 중입니다. 11433 으로 재시작합니다..."
    pkill -x ollama 2>/dev/null; sleep 1
    OLLAMA_HOST="0.0.0.0:11433" OLLAMA_ORIGINS="chrome-extension://*" /usr/local/bin/ollama serve &>/dev/null &
    disown
    sleep 3
    curl -sf http://localhost:11433/api/tags &>/dev/null \
      && ok "Ollama 재시작 완료 (포트 11433)" \
      || fail "Ollama 재시작 실패"
  fi
else
  warn "Ollama 를 시작합니다 (포트 11433)..."
  OLLAMA_HOST="0.0.0.0:11433" OLLAMA_ORIGINS="chrome-extension://*" /usr/local/bin/ollama serve &>/dev/null &
  disown
  sleep 3
  curl -sf http://localhost:11433/api/tags &>/dev/null \
    && ok "Ollama 시작 완료 (포트 11433)" \
    || { warn "Ollama 시작 확인 실패. 수동으로 실행하세요:"; echo "  OLLAMA_HOST=0.0.0.0:11433 OLLAMA_ORIGINS='chrome-extension://*' ollama serve &"; }
fi

# ── 4. 익스텐션 빌드 (--build 옵션) ──────
if [[ "${1}" == "--build" ]]; then
  echo ""
  warn "Chrome 익스텐션 빌드 중..."
  cd "${SCRIPT_DIR}/dremio-chat-extension" && npm run build 2>&1 | tail -5
  ok "빌드 완료 → dist/ 폴더를 Chrome 에 로드하세요"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "시작 완료"
echo "  • Dremio UI    : http://localhost:9046"
echo "  • PostgreSQL   : localhost:5431"
echo "  • Ollama API   : http://localhost:11433"
echo ""
echo "  Ctrl+C 로 모든 서비스 종료"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 5. Ctrl+C 시 모든 서비스 종료 ──────────
shutdown() {
  echo ""
  warn "서비스 종료 중..."
  cd "${SCRIPT_DIR}" && $DOCKER compose down
  pkill -x ollama 2>/dev/null
  ok "모든 서비스 종료 완료"
  exit 0
}
trap shutdown INT TERM

# 포그라운드 대기 (서비스는 Docker 가 관리, 여기서는 신호만 대기)
while true; do sleep 60; done
