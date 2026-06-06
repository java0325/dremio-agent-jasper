import { useEffect, useRef, useState } from "react";
import type React from "react";
import { DEFAULT_QWEN_MODEL } from "../../shared/config";
import { runDremioQuery, type QueryResult } from "../services/dremioClient";
import { useDremioContext } from "../hooks/useDremioContext";
import { useQwenChat } from "../hooks/useQwenChat";

type ChatPanelProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [visible, setVisible] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const dremio = useDremioContext();

  // Dremio 토큰으로 쿼리 실행 콜백
  const runQuery = dremio.token
    ? (sql: string): Promise<QueryResult> => runDremioQuery(dremio.token!, sql)
    : undefined;

  const { messages, isLoading, connectionStatus, connectionError, refreshHealth, sendMessage } =
    useQwenChat(dremio.schemaContext, runQuery);

  // 패널 열릴 때 Dremio 스키마 새로고침
  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setIsClosing(false);
      dremio.refresh();
      void refreshHealth();
    } else if (visible) {
      setIsClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        setIsClosing(false);
      }, 300);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, visible, isLoading]);

  if (!visible) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    sendMessage(trimmed);
  };

  // ─── Ollama 상태 배지 ──────────────────────────────────
  const ollamaLabel =
    connectionStatus === "checking"
      ? "Ollama 확인 중..."
      : connectionStatus === "connected"
        ? `Qwen ${DEFAULT_QWEN_MODEL}`
        : "Ollama 연결 안 됨";

  const ollamaColor =
    connectionStatus === "connected"
      ? "bg-emerald-100 text-emerald-700"
      : connectionStatus === "checking"
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";

  // ─── Dremio 상태 배지 ─────────────────────────────────
  const dremioLabel =
    dremio.status === "loading"
      ? "DB 읽는 중..."
      : dremio.status === "connected"
        ? `Dremio ${dremio.sources.length}개 소스 연결됨`
        : dremio.status === "auth_required"
          ? "Dremio 로그인 필요"
          : "Dremio 오류";

  const dremioColor =
    dremio.status === "connected"
      ? "bg-teal-100 text-teal-700"
      : dremio.status === "loading"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <>
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 z-[2147483644] bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 채팅 패널 */}
      <aside
        role="dialog"
        aria-label="Dremio 채팅 패널"
        className={[
          "fixed right-0 top-0 z-[2147483645] flex h-full w-full max-w-5xl flex-col",
          "border-l border-slate-200 bg-white shadow-2xl",
          isClosing ? "animate-slide-out-right" : "animate-slide-in-right",
        ].join(" ")}
      >
        {/* 헤더 */}
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Dremio Assistant</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {/* Ollama 배지 */}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ollamaColor}`}>
                {ollamaLabel}
              </span>
              {connectionStatus === "error" && (
                <button
                  type="button"
                  onClick={() => void refreshHealth()}
                  className="text-[11px] text-teal-600 hover:underline"
                >
                  재연결
                </button>
              )}
              {/* Dremio DB 배지 */}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${dremioColor}`}>
                {dremioLabel}
              </span>
              {dremio.status === "connected" && (
                <button
                  type="button"
                  onClick={dremio.refresh}
                  className="text-[11px] text-slate-400 hover:text-teal-600"
                  title="스키마 새로고침"
                >
                  ↺
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="패널 닫기"
            className="ml-2 shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <CloseIcon />
          </button>
        </header>

        {/* Ollama 오류 배너 */}
        {connectionStatus === "error" && connectionError && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-xs leading-relaxed text-red-700">
            {connectionError}
            <div className="mt-1 font-mono text-[11px] text-red-600">
              ollama pull {DEFAULT_QWEN_MODEL}
            </div>
          </div>
        )}

        {/* Dremio 로그인 폼 (인증이 필요할 때) */}
        {dremio.status === "auth_required" && (
          <DremioLoginForm
            error={dremio.errorMsg}
            onLogin={dremio.login}
          />
        )}

        {/* Dremio 오류 배너 */}
        {dremio.status === "error" && dremio.errorMsg && (
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-700">
            {dremio.errorMsg}
            <button
              type="button"
              onClick={dremio.refresh}
              className="ml-2 underline"
            >
              재시도
            </button>
          </div>
        )}

        {/* 연결된 테이블 요약 */}
        {dremio.status === "connected" && dremio.sources.length > 0 && (
          <div className="border-b border-teal-50 bg-teal-50/60 px-5 py-2">
            <p className="text-[11px] font-medium text-teal-700">연결된 테이블</p>
            <ul className="mt-0.5 space-y-0.5">
              {dremio.sources.map((src) =>
                src.tables.slice(0, 5).map((tbl) => (
                  <li
                    key={tbl.path.join(".")}
                    className="text-[11px] text-teal-600 font-mono truncate"
                  >
                    {tbl.path.map((p) => `"${p}"`).join(".")}
                    {tbl.datasetType === "VIRTUAL" && (
                      <span className="ml-1 text-[10px] opacity-60">[뷰]</span>
                    )}
                  </li>
                )),
              )}
              {dremio.sources.reduce((n, s) => n + s.tables.length, 0) > 5 && (
                <li className="text-[11px] text-teal-400">
                  외 {dremio.sources.reduce((n, s) => n + s.tables.length, 0) - 5}개…
                </li>
              )}
            </ul>
          </div>
        )}

        {/* 메시지 영역 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={["flex", msg.role === "user" ? "justify-end" : "justify-start"].join(" ")}
            >
              <div
                className={[
                  "max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-teal-600 text-white whitespace-pre-wrap"
                    : "bg-slate-100 text-slate-800",
                ].join(" ")}
              >
                {msg.role === "user" ? (
                  msg.content
                ) : msg.content ? (
                  <MessageContent content={msg.content} />
                ) : isLoading ? (
                  <TypingIndicator />
                ) : null}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 입력창 */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-slate-200 px-4 py-4"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              rows={2}
              disabled={isLoading}
              placeholder={
                dremio.status === "connected"
                  ? "SQL 질문이나 테이블 분석을 요청하세요..."
                  : "Dremio에 로그인한 후 질문하세요..."
              }
              className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? "…" : "전송"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

// ─── 로그인 폼 컴포넌트 ────────────────────────────────
function DremioLoginForm({
  error,
  onLogin,
}: {
  error: string | null;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || loading) return;
    setLoading(true);
    await onLogin(username, password);
    setLoading(false);
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="border-b border-slate-200 bg-slate-50 px-5 py-4 space-y-3"
    >
      <p className="text-xs font-semibold text-slate-600">Dremio 로그인</p>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
      )}
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="아이디"
        autoComplete="username"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        autoComplete="current-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
      <button
        type="submit"
        disabled={!username || !password || loading}
        className="w-full rounded-lg bg-teal-600 py-2 text-sm font-medium text-white transition hover:bg-teal-500 disabled:opacity-40"
      >
        {loading ? "연결 중…" : "연결"}
      </button>
    </form>
  );
}

// ─── 마크다운 메시지 렌더러 ───────────────────────────
function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```|---\n[\s\S]*?)/).filter(Boolean);

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        // SQL/코드 블록
        const codeMatch = part.match(/^```(?:sql)?\s*\n?([\s\S]*?)```$/i);
        if (codeMatch) {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg bg-slate-800 px-3 py-2 text-xs text-emerald-300 font-mono whitespace-pre-wrap"
            >
              {codeMatch[1].trim()}
            </pre>
          );
        }
        // 구분선으로 시작하는 결과 섹션
        if (part.startsWith("---\n")) {
          const inner = part.slice(4);
          // 마크다운 테이블 포함 여부 확인
          if (inner.includes("| --- |") || inner.match(/\|.*\|.*\|/)) {
            const lines = inner.split("\n");
            const titleLine = lines[0];
            const tableLines = lines.slice(1).filter((l) => l.trim());
            return (
              <div key={i} className="rounded-lg bg-white border border-slate-200 overflow-hidden">
                {titleLine && (
                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                    {titleLine.replace(/\*\*/g, "")}
                  </div>
                )}
                <TableRenderer lines={tableLines} />
              </div>
            );
          }
          return (
            <div key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 whitespace-pre-wrap">
              {inner}
            </div>
          );
        }
        // 일반 텍스트 (bold 처리)
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(part)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

function TableRenderer({ lines }: { lines: string[] }) {
  const rows = lines
    .filter((l) => l.startsWith("|") && !l.match(/^\|[\s-|]+\|$/))
    .map((l) =>
      l.split("|").filter((_, i, a) => i > 0 && i < a.length - 1).map((c) => c.trim()),
    );
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50">
            {header.map((h, i) => (
              <th key={i} className="px-3 py-1.5 text-left font-semibold text-slate-600 border-b border-slate-200">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-slate-700 border-b border-slate-100">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── 공용 아이콘 ───────────────────────────────────────
function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
    </span>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path
        fillRule="evenodd"
        d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
