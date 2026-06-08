/**
 * Dremio SQL 표준 규칙 및 공통 프롬프트 환경 파일
 *
 * 이 파일은 LLM이 생성하는 SQL의 품질을 보장하기 위한
 * 표준 규칙, 용어 정의, 스키마 힌트를 관리합니다.
 * config.ts 의 buildSystemPrompt() 에서 참조됩니다.
 */

// ────────────────────────────────────────────────────────────
// 1. Dremio SQL 표준 규칙
// ────────────────────────────────────────────────────────────

/** Dremio SQL 문법 제약 사항 */
export const DREMIO_SQL_RULES = `
DREMIO SQL RULES (must follow strictly):
- Catalog path syntax: "SourceName"."schema".table  (double-quoted)
- Each sql code block must contain EXACTLY ONE statement (no semicolon-separated multi-statements)
- LIMIT must be a plain integer literal only: LIMIT 10 (correct) / LIMIT (expr) (WRONG)
- Do NOT use: PERCENTILE_CONT, PERCENTILE_DISC, or unsupported window functions
- PostgreSQL cast syntax (::TYPE) is NOT supported — use CAST(expr AS TYPE) instead
- String literal casts like 'MM'::TEXT are invalid — write just 'MM'
- Column aliases must be ASCII English only — no Korean/non-ASCII in SQL
- Reserved words used as aliases must be double-quoted: AS "month", AS "year", AS "rank"
`.trim();

// ────────────────────────────────────────────────────────────
// 2. 한국어 용어 → SQL 표현 매핑 (표준 해석 규칙)
// ────────────────────────────────────────────────────────────

/** 한국어 시간 단위 → TO_CHAR 포맷 표준 매핑 */
export const KOREAN_TIME_TERMS: Record<string, { format: string; example: string }> = {
  "연도별":    { format: "YYYY",    example: "TO_CHAR(o.order_date, 'YYYY') AS year_name" },
  "연간":      { format: "YYYY",    example: "TO_CHAR(o.order_date, 'YYYY') AS year_name" },
  "년도별":    { format: "YYYY",    example: "TO_CHAR(o.order_date, 'YYYY') AS year_name" },
  "월별":      { format: "YYYY-MM", example: "TO_CHAR(o.order_date, 'YYYY-MM') AS order_month" },
  "월간":      { format: "YYYY-MM", example: "TO_CHAR(o.order_date, 'YYYY-MM') AS order_month" },
  "월단위":    { format: "YYYY-MM", example: "TO_CHAR(o.order_date, 'YYYY-MM') AS order_month" },
  "분기별":    { format: "YYYY-Q",  example: "CONCAT(TO_CHAR(o.order_date,'YYYY'),'-Q',QUARTER(o.order_date)) AS quarter_name" },
  "일별":      { format: "YYYY-MM-DD", example: "TO_CHAR(o.order_date, 'YYYY-MM-DD') AS order_date_str" },
  "일간":      { format: "YYYY-MM-DD", example: "TO_CHAR(o.order_date, 'YYYY-MM-DD') AS order_date_str" },
};

/** 한국어 분석 용어 → SQL 패턴 표준 매핑 */
export const KOREAN_ANALYSIS_TERMS: Record<string, string> = {
  "판매 순위":   "RANK() OVER (PARTITION BY <time_col> ORDER BY SUM(oi.quantity * oi.unit_price) DESC) AS sales_rank",
  "매출 순위":   "RANK() OVER (PARTITION BY <time_col> ORDER BY SUM(oi.quantity * oi.unit_price) DESC) AS revenue_rank",
  "총매출":      "SUM(oi.quantity * oi.unit_price) AS total_revenue",
  "판매건수":    "COUNT(DISTINCT o.order_id) AS order_count",
  "판매수량":    "SUM(oi.quantity) AS total_qty",
  "평균매출":    "AVG(oi.quantity * oi.unit_price) AS avg_revenue",
};

// ────────────────────────────────────────────────────────────
// 3. SampleSalesDB 스키마 힌트 (LLM 컬럼 오류 방지)
// ────────────────────────────────────────────────────────────

/** SampleSalesDB 테이블별 컬럼 목록 및 사용 힌트 */
export const SCHEMA_HINTS = `
SampleSalesDB schema hints (use ONLY these exact column names):
  orders (alias o):       order_id, customer_id, order_date, status, total_amount
  order_items (alias oi): item_id, order_id, product_id, quantity, unit_price
  products (alias p):     product_id, product_name, category, price, stock_quantity
  customers (alias c):    customer_id, first_name, last_name, email, phone, city, country

Key rules:
- quantity, unit_price → "order_items" (oi) only, NOT "orders"
- item_id → "order_items" (oi.item_id), NEVER o.item_id
- For sales amount: SUM(oi.quantity * oi.unit_price)
- For month grouping: GROUP BY TO_CHAR(o.order_date, 'YYYY-MM')
`.trim();

// ────────────────────────────────────────────────────────────
// 4. 표준 SQL 템플릿
// ────────────────────────────────────────────────────────────

/** 자주 쓰이는 표준 SQL 패턴 모음 */
export const SQL_TEMPLATES = {
  /** 월별 카테고리 매출 순위 */
  monthlyCategoryRank: `
SELECT
  TO_CHAR(o.order_date, 'YYYY-MM') AS order_month,
  p.category,
  SUM(oi.quantity * oi.unit_price) AS total_revenue,
  COUNT(DISTINCT o.order_id) AS order_count,
  RANK() OVER (PARTITION BY TO_CHAR(o.order_date, 'YYYY-MM')
               ORDER BY SUM(oi.quantity * oi.unit_price) DESC) AS sales_rank
FROM "SampleSalesDB"."sales".orders o
JOIN "SampleSalesDB"."sales".order_items oi ON o.order_id = oi.order_id
JOIN "SampleSalesDB"."sales".products p ON oi.product_id = p.product_id
WHERE o.status IS NOT NULL AND o.total_amount > 0
GROUP BY TO_CHAR(o.order_date, 'YYYY-MM'), p.category
ORDER BY order_month DESC, sales_rank ASC
LIMIT 20`.trim(),

  /** 카테고리별 총매출 집계 */
  categoryRevenue: `
SELECT
  p.category,
  SUM(oi.quantity * oi.unit_price) AS total_revenue,
  COUNT(DISTINCT o.order_id) AS order_count,
  SUM(oi.quantity) AS total_qty
FROM "SampleSalesDB"."sales".orders o
JOIN "SampleSalesDB"."sales".order_items oi ON o.order_id = oi.order_id
JOIN "SampleSalesDB"."sales".products p ON oi.product_id = p.product_id
WHERE o.status IS NOT NULL
GROUP BY p.category
ORDER BY total_revenue DESC`.trim(),

  /** 상품별 판매 실적 */
  productSales: `
SELECT
  p.product_name,
  p.category,
  SUM(oi.quantity) AS total_qty,
  SUM(oi.quantity * oi.unit_price) AS total_revenue
FROM "SampleSalesDB"."sales".order_items oi
JOIN "SampleSalesDB"."sales".products p ON oi.product_id = p.product_id
GROUP BY p.product_name, p.category
ORDER BY total_revenue DESC
LIMIT 20`.trim(),

  /** 고객별 구매 실적 */
  customerPurchase: `
SELECT
  c.customer_id,
  c.first_name,
  c.last_name,
  COUNT(DISTINCT o.order_id) AS order_count,
  SUM(oi.quantity * oi.unit_price) AS total_spent
FROM "SampleSalesDB"."sales".customers c
JOIN "SampleSalesDB"."sales".orders o ON c.customer_id = o.customer_id
JOIN "SampleSalesDB"."sales".order_items oi ON o.order_id = oi.order_id
WHERE o.status IS NOT NULL
GROUP BY c.customer_id, c.first_name, c.last_name
ORDER BY total_spent DESC
LIMIT 20`.trim(),
} as const;

// ────────────────────────────────────────────────────────────
// 5. 표준 프롬프트 빌더
// ────────────────────────────────────────────────────────────

/** 표준 규칙을 포함한 시스템 프롬프트 섹션 생성 */
export function buildStandardRulesSection(): string {
  const timeTermsText = Object.entries(KOREAN_TIME_TERMS)
    .map(([k, v]) => `  - "${k}" → format '${v.format}' | example: ${v.example}`)
    .join("\n");

  return `
${DREMIO_SQL_RULES}

KOREAN TERM MAPPING (interpret these consistently):
${timeTermsText}

${SCHEMA_HINTS}
`.trim();
}
