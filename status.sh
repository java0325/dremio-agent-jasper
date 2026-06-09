#!/usr/bin/env zsh
# ─────────────────────────────────────────────
#  status.sh  –  Dremio Agent 환경 상태 확인
#  관리 포트: Dremio 9046 / PostgreSQL 5431 / Ollama 11433
# ─────────────────────────────────────────────

DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

container_status() {
  local name="$1"
  local cstate
  cstate=$($DOCKER inspect -f '{{.State.Status}}' "$name" 2>/dev/null)
  case "$cstate" in
    running) echo -n "${GREEN}● running${NC}" ;;
    exited)  echo -n "${RED}○ exited${NC}" ;;
    created) echo -n "${YELLOW}○ created (미시작)${NC}" ;;
    "")      echo -n "${RED}✗ 컨테이너 없음${NC}" ;;
    *)       echo -n "${YELLOW}? ${cstate}${NC}" ;;
  esac
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dremio Agent 환경 상태"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Docker ────────────────────────────────
echo ""
echo "${CYAN}[Docker]${NC}"
if $DOCKER info &>/dev/null; then
  echo "  Docker Desktop   : ${GREEN}● 실행 중${NC}"
else
  echo "  Docker Desktop   : ${RED}○ 중지됨${NC}"
fi

# ── 관리 컨테이너 ──────────────────────────
echo ""
echo "${CYAN}[관리 컨테이너]${NC}"
printf "  %-22s : " "dremio-agent (9046)"
container_status "dremio-agent"
echo ""
printf "  %-22s : " "sample-postgres (5431)"
container_status "sample-postgres"
echo ""

# ── 독립 운영 컨테이너 (참고용) ───────────
echo ""
echo "${CYAN}[독립 운영 - 참고만]${NC}"
printf "  %-22s : " "dremio-oss (9047)"
container_status "dremio-oss"
echo " ${YELLOW}← 이 프로그램과 무관${NC}"

# ── Ollama ────────────────────────────────
echo ""
echo "${CYAN}[Ollama]${NC}"
if curl -sf --max-time 2 http://localhost:11433/api/tags &>/dev/null; then
  OLLAMA_PID=$(pgrep -x ollama 2>/dev/null)
  echo "  API (11433)      : ${GREEN}● 응답 정상${NC}${OLLAMA_PID:+ (PID: ${OLLAMA_PID})}"
  MODELS=$(curl -sf http://localhost:11433/api/tags | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [m['name'] for m in data.get('models', [])]
print(', '.join(names[:5]) + ('...' if len(names) > 5 else '') if names else '모델 없음')
" 2>/dev/null)
  echo "  로드된 모델      : ${MODELS:-확인 불가}"
else
  echo "  API (11433)      : ${RED}○ 응답 없음${NC}"
  if pgrep -x ollama &>/dev/null; then
    echo "  ${YELLOW}! Ollama 프로세스가 다른 포트에서 실행 중입니다.${NC}"
    echo "    start.sh 를 실행하면 11433 으로 재시작됩니다."
  fi
fi

# ── 접속 확인 ─────────────────────────────
echo ""
echo "${CYAN}[접속 확인]${NC}"
if curl -sf --max-time 3 http://localhost:9046 &>/dev/null; then
  echo "  Dremio UI (9046) : ${GREEN}● 응답 정상${NC}"
else
  echo "  Dremio UI (9046) : ${RED}○ 응답 없음${NC}"
fi
if curl -sf --max-time 2 http://localhost:5431 &>/dev/null 2>/dev/null; then
  echo "  PostgreSQL(5431) : ${GREEN}● 응답 정상${NC}"
else
  PG_STATE=$($DOCKER inspect -f '{{.State.Status}}' sample-postgres 2>/dev/null)
  [[ "$PG_STATE" == "running" ]] \
    && echo "  PostgreSQL(5431) : ${GREEN}● 컨테이너 실행 중${NC}" \
    || echo "  PostgreSQL(5431) : ${RED}○ 응답 없음${NC}"
fi

# ── 익스텐션 빌드 정보 ─────────────────────
echo ""
echo "${CYAN}[Chrome 익스텐션]${NC}"
SCRIPT_DIR="${0:A:h}"
DIST_DIR="${SCRIPT_DIR}/dremio-chat-extension/dist"
if [[ -d "$DIST_DIR" ]]; then
  BUILD_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "${DIST_DIR}/manifest.json" 2>/dev/null)
  echo "  빌드 상태        : ${GREEN}● 빌드 있음${NC} (${BUILD_TIME:-날짜 불명})"
  EXT_PORTS=($(grep -o '"http://localhost:[0-9]*' "${DIST_DIR}/manifest.json" 2>/dev/null | grep -o '[0-9]*$' | sort -u))
  echo "  허용 포트        : ${(j:, :)EXT_PORTS}"
else
  echo "  빌드 상태        : ${YELLOW}! dist/ 없음 — ./start.sh --build 실행 필요${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ./start.sh [--build]   환경 시작"
echo "  ./stop.sh              환경 중지"
echo "  ./status.sh            이 화면"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
