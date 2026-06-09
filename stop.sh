#!/usr/bin/env zsh
# ─────────────────────────────────────────────
#  stop.sh  –  Dremio Agent 환경 중지
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
echo "  Dremio Agent 환경 중지"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. docker-compose 서비스 중지 ─────────
cd "${SCRIPT_DIR}"
for svc in dremio-agent sample-postgres; do
  CSTATE=$($DOCKER inspect -f '{{.State.Status}}' "$svc" 2>/dev/null)
  if [[ "$CSTATE" == "running" ]]; then
    $DOCKER stop "$svc" &>/dev/null \
      && ok "${svc} 중지 완료" \
      || fail "${svc} 중지 실패"
  elif [[ -z "$CSTATE" ]]; then
    warn "${svc} 컨테이너 없음 (건너뜀)"
  else
    ok "${svc} 이미 중지됨 (${CSTATE})"
  fi
done

# ── 2. Ollama 중지 (포트 11433 에서 실행 중인 경우만) ──
if curl -sf --max-time 2 http://localhost:11433/api/tags &>/dev/null; then
  OLLAMA_PID=$(pgrep -x ollama 2>/dev/null)
  if [[ -n "$OLLAMA_PID" ]]; then
    kill "$OLLAMA_PID" 2>/dev/null \
      && ok "Ollama 중지 완료 (PID: ${OLLAMA_PID})" \
      || fail "Ollama 중지 실패"
  fi
else
  ok "Ollama(11433) 이미 중지됨"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "중지 완료 (dremio-oss 는 영향 없음)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
