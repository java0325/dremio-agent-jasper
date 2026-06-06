import { useCallback, useEffect, useState } from "react";
import {
  type DremioSource,
  discoverTokenFromStorage,
  fetchDremioSources,
  formatSchemaForLLM,
  loginDremio,
} from "../services/dremioClient";

const STORAGE_KEY = "dremio_ext_token";

function loadStoredToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      resolve((res[STORAGE_KEY] as string | undefined) ?? null);
    });
  });
}

function saveToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: token }, resolve);
  });
}

function clearStoredToken(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY], resolve);
  });
}

export type DremioStatus =
  | "idle"
  | "loading"
  | "connected"
  | "auth_required"
  | "error";

export function useDremioContext() {
  const [token, setToken] = useState<string | null>(null);
  const [sources, setSources] = useState<DremioSource[]>([]);
  const [schemaContext, setSchemaContext] = useState<string>("");
  const [status, setStatus] = useState<DremioStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const applyToken = useCallback(async (tok: string) => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const srcs = await fetchDremioSources(tok);
      setSources(srcs);
      setSchemaContext(formatSchemaForLLM(srcs));
      setStatus("connected");
    } catch (e) {
      if (e instanceof Error && e.message === "AUTH_EXPIRED") {
        await clearStoredToken();
        setToken(null);
        setStatus("auth_required");
        setErrorMsg("세션이 만료되었습니다. 다시 로그인해주세요.");
      } else {
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "스키마 조회 실패");
      }
    }
  }, []);

  const init = useCallback(async () => {
    setStatus("loading");

    // 1. chrome.storage에 저장된 토큰
    let tok = await loadStoredToken();

    // 2. 페이지 localStorage 스캔 (Dremio가 redux-persist로 저장한 경우)
    if (!tok) tok = discoverTokenFromStorage();

    if (tok) {
      setToken(tok);
      await saveToken(tok);
      await applyToken(tok);
    } else {
      setStatus("auth_required");
    }
  }, [applyToken]);

  const login = useCallback(
    async (username: string, password: string) => {
      setStatus("loading");
      setErrorMsg(null);
      try {
        const tok = await loginDremio(username, password);
        setToken(tok);
        await saveToken(tok);
        await applyToken(tok);
      } catch (e) {
        setStatus("auth_required");
        setErrorMsg(e instanceof Error ? e.message : "로그인 실패");
      }
    },
    [applyToken],
  );

  const refresh = useCallback(() => {
    if (token) void applyToken(token);
    else void init();
  }, [token, applyToken, init]);

  const logout = useCallback(async () => {
    await clearStoredToken();
    setToken(null);
    setSources([]);
    setSchemaContext("");
    setStatus("auth_required");
    setErrorMsg(null);
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  return { token, sources, schemaContext, status, errorMsg, login, refresh, logout };
}
