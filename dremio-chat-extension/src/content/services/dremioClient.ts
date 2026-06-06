const DREMIO = "http://localhost:9047";

// ─── API 타입 ─────────────────────────────────────────
type CatalogChild = {
  id: string;
  path: string[];
  type: "CONTAINER" | "DATASET" | "FILE";
  containerType?: string;
  datasetType?: string;
};

type CatalogDetail = {
  id: string;
  name: string;
  type?: string;
  entityType?: string;
  children?: CatalogChild[];
  fields?: Array<{ name: string; type?: { name?: string } }>;
};

type CatalogRoot = {
  data?: CatalogChild[];
};

export type SchemaTable = {
  path: string[];
  datasetType: string;
  columns?: Array<{ name: string; type: string }>;
};

export type DremioSource = {
  id: string;
  name: string;
  sourceType: string;
  tables: SchemaTable[];
};

// ─── 토큰 자동 탐색 (localStorage 스캔) ────────────────
const TOKEN_RE = /^[a-z0-9]{20,60}$/;

function searchToken(obj: unknown, depth = 0): string | null {
  if (depth > 6 || !obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && TOKEN_RE.test(v)) {
      const lk = k.toLowerCase();
      if (lk === "token" || lk.endsWith("token") || lk.includes("authtoken")) {
        return v;
      }
    }
    if (v && typeof v === "object") {
      const found = searchToken(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function discoverTokenFromStorage(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (TOKEN_RE.test(raw)) return raw;
      try {
        const found = searchToken(JSON.parse(raw));
        if (found) return found;
      } catch {
        /* not JSON */
      }
    }
  } catch {
    /* localStorage inaccessible */
  }
  return null;
}

// ─── Dremio 로그인 ─────────────────────────────────────
export async function loginDremio(
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${DREMIO}/apiv2/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: username, password }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "아이디 또는 비밀번호가 올바르지 않습니다."
        : `로그인 실패 (${res.status})`,
    );
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("서버에서 토큰을 받지 못했습니다.");
  return data.token;
}

// ─── 내부 API fetch 헬퍼 ───────────────────────────────
async function apiFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${DREMIO}${path}`, {
    headers: { Authorization: `_dremio${token}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error("AUTH_EXPIRED");
  if (!res.ok) throw new Error(`API 오류 (${res.status}): ${path}`);
  return res.json() as Promise<T>;
}

// ─── 재귀적으로 테이블 수집 (컬럼 정보 포함) ────────────
async function collectTables(
  token: string,
  id: string,
): Promise<SchemaTable[]> {
  const detail = await apiFetch<CatalogDetail>(token, `/api/v3/catalog/${id}`);
  const tables: SchemaTable[] = [];

  await Promise.all(
    (detail.children ?? []).map(async (child) => {
      if (child.type === "DATASET") {
        // 컬럼 정보 포함해서 가져오기
        try {
          const dsDetail = await apiFetch<CatalogDetail>(
            token,
            `/api/v3/catalog/${child.id}`,
          );
          tables.push({
            path: child.path,
            datasetType: child.datasetType ?? "DIRECT",
            columns: (dsDetail.fields ?? []).map((f) => ({
              name: f.name,
              type: f.type?.name ?? "ANY",
            })),
          });
        } catch {
          tables.push({
            path: child.path,
            datasetType: child.datasetType ?? "DIRECT",
          });
        }
      } else if (child.type === "CONTAINER" && child.containerType === "FOLDER") {
        tables.push(...(await collectTables(token, child.id)));
      }
    }),
  );

  return tables;
}

// ─── 전체 소스 목록 조회 ───────────────────────────────
export async function fetchDremioSources(
  token: string,
): Promise<DremioSource[]> {
  const root = await apiFetch<CatalogRoot>(token, "/api/v3/catalog");
  const items = root.data ?? [];
  const sources: DremioSource[] = [];

  await Promise.all(
    items
      .filter(
        (item) =>
          item.type === "CONTAINER" &&
          item.containerType !== "HOME",
      )
      .map(async (item) => {
        try {
          const detail = await apiFetch<CatalogDetail>(
            token,
            `/api/v3/catalog/${item.id}`,
          );
          const tables = await collectTables(token, item.id);
          sources.push({
            id: detail.id,
            name: detail.name,
            sourceType: detail.type ?? item.containerType ?? "UNKNOWN",
            tables,
          });
        } catch {
          /* 로드 실패한 소스는 건너뜀 */
        }
      }),
  );

  return sources;
}

// ─── 쿼리 실행 결과 타입 ───────────────────────────────
export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
};

// ─── Dremio SQL 쿼리 실행 (job polling) ───────────────
export async function runDremioQuery(
  token: string,
  sql: string,
): Promise<QueryResult> {
  const submitRes = await fetch(`${DREMIO}/api/v3/sql`, {
    method: "POST",
    headers: {
      Authorization: `_dremio${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql }),
  });
  if (submitRes.status === 401 || submitRes.status === 403) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!submitRes.ok) {
    const msg = await submitRes.text().catch(() => "");
    throw new Error(`쿼리 제출 실패 (${submitRes.status}): ${msg}`);
  }
  const { id: jobId } = (await submitRes.json()) as { id: string };

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const jobRes = await fetch(`${DREMIO}/api/v3/job/${jobId}`, {
      headers: { Authorization: `_dremio${token}` },
    });
    if (!jobRes.ok) continue;
    const job = (await jobRes.json()) as {
      jobState: string;
      errorMessage?: string;
    };

    if (job.jobState === "FAILED" || job.jobState === "CANCELED") {
      throw new Error(job.errorMessage ?? "쿼리 실행 실패");
    }

    if (job.jobState === "COMPLETED") {
      const resultRes = await fetch(
        `${DREMIO}/api/v3/job/${jobId}/results?offset=0&limit=100`,
        { headers: { Authorization: `_dremio${token}` } },
      );
      if (!resultRes.ok) throw new Error("결과 조회 실패");
      const data = (await resultRes.json()) as {
        schema: Array<{ name: string }>;
        rows: Array<Record<string, unknown>>;
        rowCount: number;
      };
      return {
        columns: data.schema.map((c) => c.name),
        rows: data.rows ?? [],
        rowCount: data.rowCount ?? (data.rows ?? []).length,
      };
    }
  }
  throw new Error("쿼리 타임아웃 (60초)");
}

// ─── QueryResult → 마크다운 테이블 ────────────────────
export function formatQueryResult(result: QueryResult): string {
  const { columns, rows, rowCount } = result;
  if (columns.length === 0 || rows.length === 0) {
    return `> *(결과 없음 — rowCount: ${rowCount})*`;
  }
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`)
    .join("\n");
  const footer =
    rowCount > rows.length
      ? `\n*(총 ${rowCount}건 중 ${rows.length}건 표시)*`
      : `\n*(총 ${rowCount}건)*`;
  return `${header}\n${sep}\n${body}${footer}`;
}

// ─── LLM용 스키마 텍스트 생성 (컬럼명 포함) ──────────
export function formatSchemaForLLM(sources: DremioSource[]): string {
  if (sources.length === 0) {
    return "(연결된 Dremio 소스가 없습니다.)";
  }

  const lines: string[] = [
    "=== Dremio 실제 카탈로그 (현재 연결된 소스, 테이블, 컬럼) ===\n",
  ];

  for (const src of sources) {
    lines.push(`[소스] ${src.name}  (타입: ${src.sourceType})`);
    if (src.tables.length === 0) {
      lines.push("  (테이블 없음)");
    } else {
      for (const tbl of src.tables) {
        const quotedPath = tbl.path.map((p) => `"${p}"`).join(".");
        const tag = tbl.datasetType === "VIRTUAL" ? " [뷰]" : "";
        lines.push(`  • ${quotedPath}${tag}`);
        if (tbl.columns && tbl.columns.length > 0) {
          // 컬럼명과 타입을 LLM이 알 수 있도록 명시
          const colStr = tbl.columns
            .map((c) => `${c.name}(${c.type})`)
            .join(", ");
          lines.push(`    columns: ${colStr}`);
        }
      }
    }
    lines.push("");
  }
  lines.push(
    "SQL 작성 시 위에 명시된 정확한 컬럼명을 사용하세요. 큰따옴표로 감싼 경로 예: \"SampleSalesDB\".\"sales\".products",
  );
  return lines.join("\n");
}
