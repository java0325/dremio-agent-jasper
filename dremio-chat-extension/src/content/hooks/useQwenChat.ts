import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_QWEN_MODEL } from "../../shared/config";
import type { ChatMessage, OllamaChatMessage } from "../../shared/types";
import { formatQueryResult, type QueryResult } from "../services/dremioClient";
import { checkOllamaHealth, streamQwenChat } from "../services/qwenClient";

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "안녕하세요! Dremio Assistant입니다. 좌측 패널에서 Dremio에 로그인하면 실제 테이블 목록을 읽어 SQL 작성, 데이터 탐색, 쿼리 설명을 도와드릴게요.",
};

// Dremio(Calcite) 예약어 목록 — 별칭으로 사용 시 큰따옴표 필요
const DREMIO_RESERVED_ALIASES = new Set([
  "MONTH", "YEAR", "DAY", "HOUR", "MINUTE", "SECOND",
  "DATE", "TIME", "TIMESTAMP", "INTERVAL",
  "VALUE", "VALUES", "COUNT", "SUM", "AVG", "MAX", "MIN",
  "TYPE", "LEVEL", "POSITION", "SIZE", "NAME", "KEY", "INDEX",
  "RANK", "ROW", "TABLE", "VIEW", "SET", "MATCH", "FORMAT",
  "REPLACE", "TRIM", "CAST", "CONVERT", "TRANSLATE",
]);

/** SELECT 절을 최상위 콤마로 분리해 한글/예약어 별칭 → 컬럼 위치 맵 반환 */
function buildAliasPositionMap(selectClause: string): Map<string, number> {
  const map = new Map<string, number>();
  const cols: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < selectClause.length; i++) {
    const ch = selectClause[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "'" ) {
      // 작은따옴표 문자열 건너뜀
      i++;
      while (i < selectClause.length && selectClause[i] !== "'") i++;
    }
    if (ch === "," && depth === 0) {
      cols.push(selectClause.slice(start, i).trim());
      start = i + 1;
    }
  }
  cols.push(selectClause.slice(start).trim());
  cols.forEach((col, idx) => {
    // 한글 별칭
    const mKorean = col.match(/\bAS\s+([\uAC00-\uD7A3]\S*)\s*$/i);
    if (mKorean) { map.set(mKorean[1], idx + 1); return; }
    // 영어 예약어 별칭 (month, year, date, rank 등) — ORDER BY에서 오류 방지
    const mEnglish = col.match(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (mEnglish && DREMIO_RESERVED_ALIASES.has(mEnglish[1].toUpperCase())) {
      map.set(mEnglish[1], idx + 1);
    }
  });
  return map;
}

/**
 * SELECT 절만 추출 — EXTRACT(YEAR FROM ...) 내부의 FROM을 무시하고
 * 최상위 FROM 키워드 위치를 찾음
 */
function extractSelectClause(sql: string): string {
  const upper = sql.toUpperCase();
  const selectIdx = upper.search(/\bSELECT\b/);
  if (selectIdx === -1) return "";
  let depth = 0, i = selectIdx + 6;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "'" ) { i++; while (i < sql.length && sql[i] !== "'") i++; }
    else if (depth === 0 && upper.slice(i).match(/^FROM\b/)) {
      return sql.slice(selectIdx + 6, i);
    }
    i++;
  }
  return sql.slice(selectIdx + 6);
}

/** SQL에서 한글 포함 주석/별칭 제거 + 정리 */
function sanitizeSQL(sql: string): string {
  const firstStatement = sql.split(/;\s*\n/)[0].replace(/;$/, "").trim();
  let result = firstStatement
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // ── 0. 한글/예약어 ORDER BY 별칭 → 컬럼 순서 번호로 대체 ──
  // extractSelectClause로 EXTRACT(YEAR FROM ...) 내부 FROM을 무시
  const selectClause = extractSelectClause(result) ||
    (result.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i)?.[1] ?? "");
  if (selectClause) {
    const posMap = buildAliasPositionMap(selectClause);
    if (posMap.size > 0) {
      result = result.replace(
        /\bORDER\s+BY\b([\s\S]*?)(?=LIMIT\b|OFFSET\b|FETCH\b|$|;)/gi,
        (_m, orderExpr: string) => {
          let rep = orderExpr;
          for (const [alias, pos] of posMap) {
            const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = /[\uAC00-\uD7A3]/.test(alias)
              ? new RegExp(escaped, "g")                      // 한글: 경계 불필요
              : new RegExp(`\\b${escaped}\\b`, "g");          // 영어: 단어 경계
            rep = rep.replace(pattern, String(pos));
          }
          return `ORDER BY${rep}`;
        },
      );
    }
  }

  // ── 1. 한글 AS 별칭 제거, 나머지 한글 제거 ──
  result = result
    .replace(/\bAS\s+[^\s,)\n]*[\uAC00-\uD7A3][^\s,)\n]*/gi, "")
    .replace(/[\uAC00-\uD7A3]+/g, "")
    .replace(/,(\s*)(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/gi, " $2")
    .replace(/\n{3,}/g, "\n\n")
    // ── 1a. 스키마 오타 자동교정: "sale". → "sales". ──
    .replace(/"SampleSalesDB"\s*\.\s*"sale"\s*\./gi, '"SampleSalesDB"."sales".')
    // ── 1b. ORDER BY ... NULLS LAST/FIRST 제거 (Dremio 불필요) ──
    .replace(/\bNULLS\s+(LAST|FIRST)\b/gi, "")
    .trim();

  // ── 2. AS 예약어 → 큰따옴표 ──
  result = result.replace(
    /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    (_m, alias: string) =>
      DREMIO_RESERVED_ALIASES.has(alias.toUpperCase()) ? `AS "${alias}"` : _m,
  );

  // ── 3. PostgreSQL :: 캐스트 → CAST(expr AS TYPE) ──
  // 문자열 리터럴::TYPE → 리터럴 그대로 ('MM'::TEXT → 'MM')
  result = result.replace(/'([^']*)'\s*::\s*[A-Za-z]+/g, "'$1'");
  // FUNC(args)::TYPE 패턴 먼저 처리 (단일 깊이 괄호)
  result = result.replace(
    /([\w.]+\([^)]*\))\s*::\s*([A-Za-z]+(?:\s*\([^)]*\))?)/g,
    (_m, expr, type) => `CAST(${expr} AS ${type})`,
  );
  // 단순 식별자::TYPE 처리
  result = result.replace(
    /([\w.]+)\s*::\s*([A-Za-z]+(?:\s*\([^)]*\))?)/g,
    (_m, expr, type) => `CAST(${expr} AS ${type})`,
  );

  // ── 4. CAST 내부 타입명 따옴표 제거 ──
  result = result.replace(
    /\bCAST\s*\(([^)]*?)\bAS\s+"([A-Za-z]+)"\s*\)/gi,
    (_m, expr, type) => `CAST(${expr.trim()} AS ${type})`,
  );

  // ── 5. GROUP BY 안의 집계함수 제거 ──
  result = result.replace(
    /\bGROUP\s+BY\b([\s\S]*?)(?=\bORDER\b|\bHAVING\b|\bLIMIT\b|$)/gi,
    (_m, clause: string) =>
      `GROUP BY${clause.split(",").filter((p) => !/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(p)).join(",")}`,
  );

  // ── 6. 빈 ORDER BY 제거 (ASC/DESC/숫자만 남은 경우는 유지) ──
  result = result.replace(
    /\bORDER\s+BY\b((?:\s*(?:\d+|ASC|DESC)?\s*,?\s*)*)\s*(?=LIMIT\b|OFFSET\b|FETCH\b|$|;)/gi,
    (_m, expr: string) => {
      const stripped = expr.replace(/\b(ASC|DESC|\d+)\b/gi, "").replace(/[,\s]/g, "");
      return stripped.length > 0 ? _m : expr.replace(/\b\d+\b/g, "").replace(/[,\s]/g, "").length === 0 &&
        /\d/.test(expr) ? _m : "";
    },
  );

  // ── 7. 괄호 불균형 수정 ──
  const open = (result.match(/\(/g) ?? []).length;
  const close = (result.match(/\)/g) ?? []).length;
  if (open > close) result += ")".repeat(open - close);

  return result;
}

/** LLM 응답에서 첫 번째 SQL 코드 블록 추출 */
function extractSQL(text: string): string | null {
  // ``` 코드 블록 우선 (개행 선택적)
  const match = text.match(/```(?:sql)?\s*\n?([\s\S]*?)```/i);
  if (match) {
    const sql = sanitizeSQL(match[1]);
    if (/\bSELECT\b/i.test(sql)) return sql;
  }
  // 폴백: 텍스트에서 SELECT ~ 끝까지 탐욕적으로 추출 후 설명 줄 제거
  const sel = text.match(/\bSELECT\b[\s\S]*$/i);
  if (sel) {
    const lines = sel[0].split("\n");
    const sqlLines: string[] = [];
    for (const line of lines) {
      // 빈 줄이나 SQL 아닌 한글 설명 줄이 나오면 중단
      if (/^[\uAC00-\uD7A3]/.test(line.trim())) break;
      sqlLines.push(line);
    }
    const sql = sanitizeSQL(sqlLines.join("\n"));
    if (sql) return sql;
  }
  return null;
}

/** SQL 실행 가능 여부 검증 */
function validateSQL(sql: string): string | null {
  // OVER 뒤에 ( 없음 → 미완성 윈도우 함수
  if (/\bOVER\b(?!\s*\()/i.test(sql)) return "윈도우 함수가 불완전합니다 (OVER 뒤에 ()가 없습니다)";
  // SELECT 바로 FROM → 컬럼 없음
  if (/\bSELECT\s+FROM\b/i.test(sql)) return "SELECT 절에 컬럼이 없습니다";
  // AS 뒤에 아무것도 없음 → 별칭 누락
  if (/\bAS\s*$/i.test(sql)) return "AS 뒤에 별칭이 없습니다";
  // AS value → 예약어 (이전 sanitize 잔재)
  if (/\bAS\s+value\b/i.test(sql)) return "SQL에 예약어 'value'가 별칭으로 사용되었습니다";
  // LIMIT (expression) → Dremio는 LIMIT에 정수 리터럴만 허용
  if (/\bLIMIT\s*\(/i.test(sql)) return "LIMIT에 수식/괄호를 사용할 수 없습니다. LIMIT 뒤에는 숫자만 가능합니다 (예: LIMIT 30)";
  // FROM/WHERE/GROUP/ORDER 앞에 쉼표 → 잘린 컬럼 목록
  if (/,\s*(FROM|WHERE|GROUP|ORDER|HAVING)\b/i.test(sql)) return "컬럼 목록이 잘렸습니다";
  // PERCENTILE_CONT 점 표기법 → 잘못된 문법
  if (/PERCENTILE_CONT\s*\([^)]*\)\s*\./i.test(sql)) return "PERCENTILE_CONT 문법이 잘못되었습니다";
  // FROM 절 없음
  if (!/\bFROM\b/i.test(sql)) return "FROM 절이 없습니다";
  return null;
}

/** QueryResult를 채팅 메시지에 붙일 텍스트로 변환 */
function renderQueryAppend(result: QueryResult | null, error: string | null): string {
  if (error) return `\n\n---\n**⚠️ 쿼리 실행 오류:** ${error}`;
  if (!result) return "";
  return `\n\n---\n**📊 쿼리 실행 결과**\n${formatQueryResult(result)}`;
}

export function useQwenChat(
  schemaContext: string,
  runQuery?: (sql: string) => Promise<QueryResult>,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "checking" | "connected" | "error"
  >("checking");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const refreshHealth = useCallback(async () => {
    setConnectionStatus("checking");
    const result = await checkOllamaHealth();
    if (result.ok) {
      setConnectionStatus("connected");
      setConnectionError(null);
    } else {
      setConnectionStatus("error");
      setConnectionError(result.error ?? "Ollama 연결 실패");
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    return () => abortRef.current?.();
  }, [refreshHealth]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      const assistantId = crypto.randomUUID();

      const historyForApi: OllamaChatMessage[] = [
        ...messages
          .filter((m) => m.id !== "welcome")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: trimmed },
      ];

      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setIsLoading(true);

      // 스트리밍 완료 후 SQL 자동 실행
      const handleDone = (fullContent: string) => {
        setIsLoading(false);
        if (!runQuery) return;
        const sql = extractSQL(fullContent);
        if (!sql) return;

        // SQL 유효성 검사
        const validationError = validateSQL(sql);
        if (validationError) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + renderQueryAppend(null, `SQL 구문 오류: ${validationError}`) }
                : m,
            ),
          );
          return;
        }

        // 쿼리 실행 중 표시
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + "\n\n---\n**⏳ 쿼리 실행 중...**" }
              : m,
          ),
        );

        runQuery(sql)
          .then((result) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                // "쿼리 실행 중..." 제거 후 결과 추가
                const base = m.content.replace(/\n\n---\n\*\*⏳ 쿼리 실행 중\.\.\.\*\*$/, "");
                return { ...m, content: base + renderQueryAppend(result, null) };
              }),
            );
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const base = m.content.replace(/\n\n---\n\*\*⏳ 쿼리 실행 중\.\.\.\*\*$/, "");
                return { ...m, content: base + renderQueryAppend(null, msg) };
              }),
            );
          });
      };

      let accumulated = "";
      abortRef.current?.();
      abortRef.current = streamQwenChat(
        historyForApi,
        {
          onChunk: (chunk) => {
            accumulated += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk }
                  : m,
              ),
            );
          },
          onDone: () => handleDone(accumulated),
          onError: (error) => {
            setIsLoading(false);
            setConnectionStatus("error");
            setConnectionError(error);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        m.content ||
                        `오류: ${error}\n\nOllama가 실행 중인지 확인하고 \`ollama pull ${DEFAULT_QWEN_MODEL}\`을 실행하세요.`,
                    }
                  : m,
              ),
            );
          },
        },
        DEFAULT_QWEN_MODEL,
        schemaContext || undefined,
      );
    },
    [isLoading, messages, schemaContext, runQuery],
  );

  return {
    messages,
    isLoading,
    connectionStatus,
    connectionError,
    refreshHealth,
    sendMessage,
  };
}
