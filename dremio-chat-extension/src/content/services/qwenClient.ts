import { buildSystemPrompt, DEFAULT_QWEN_MODEL, OLLAMA_BASE_URLS } from "../../shared/config";
import type {
  BackgroundResponse,
  ChatStreamError,
  HealthCheckError,
  HealthCheckResponse,
  OllamaChatMessage,
} from "../../shared/types";

const CHAT_PORT = "qwen-chat";

function openPort() {
  return chrome.runtime.connect({ name: CHAT_PORT });
}

type OllamaTagsResponse = {
  models?: Array<{ name: string }>;
};

type OllamaStreamLine = {
  message?: { content?: string };
  done?: boolean;
  error?: string;
};

async function fetchAvailableModelsDirect(): Promise<string[]> {
  let lastError: unknown;
  for (const baseUrl of OLLAMA_BASE_URLS) {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`Ollama 응답 오류 (${res.status})`);
      const data = (await res.json()) as OllamaTagsResponse;
      return (data.models ?? []).map((m) => m.name);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Ollama에 연결할 수 없습니다.");
}

async function checkOllamaHealthDirect(): Promise<{
  ok: boolean;
  model: string;
  error?: string;
}> {
  try {
    const models = await fetchAvailableModelsDirect();
    const hasModel = models.some(
      (n) => n === DEFAULT_QWEN_MODEL || n.startsWith(`${DEFAULT_QWEN_MODEL}:`),
    );
    if (!hasModel) {
      return {
        ok: false,
        model: DEFAULT_QWEN_MODEL,
        error: `Qwen 모델이 없습니다. 터미널에서 실행: ollama pull ${DEFAULT_QWEN_MODEL}`,
      };
    }
    return { ok: true, model: DEFAULT_QWEN_MODEL };
  } catch (error) {
    return {
      ok: false,
      model: DEFAULT_QWEN_MODEL,
      error: error instanceof Error ? error.message : "Ollama에 연결할 수 없습니다.",
    };
  }
}

function shouldTryDirectFallback(error?: string): boolean {
  if (!error) return false;
  return /Failed to fetch|Load failed|NetworkError|Ollama에 연결|서비스에 연결/.test(error);
}

export async function checkOllamaHealth(): Promise<{
  ok: boolean;
  model: string;
  error?: string;
}> {
  const backgroundHealth = await new Promise<{
    ok: boolean;
    model: string;
    error?: string;
  }>((resolve) => {
    const port = openPort();
    let settled = false;

    const finish = (result: { ok: boolean; model: string; error?: string }) => {
      if (settled) return;
      settled = true;
      port.disconnect();
      resolve(result);
    };

    port.onMessage.addListener((msg: BackgroundResponse) => {
      if (msg.type === "HEALTH_OK") {
        const health = msg as HealthCheckResponse;
        finish({ ok: true, model: health.model });
      }
      if (msg.type === "HEALTH_ERROR") {
        const err = msg as HealthCheckError;
        finish({ ok: false, model: DEFAULT_QWEN_MODEL, error: err.error });
      }
    });

    port.onDisconnect.addListener(() => {
      finish({
        ok: false,
        model: DEFAULT_QWEN_MODEL,
        error: "익스텐션 백그라운드 서비스에 연결할 수 없습니다.",
      });
    });

    port.postMessage({ type: "HEALTH_CHECK" });
  });

  if (backgroundHealth.ok || !shouldTryDirectFallback(backgroundHealth.error)) {
    return backgroundHealth;
  }
  return checkOllamaHealthDirect();
}

function streamQwenChatDirect(
  messages: OllamaChatMessage[],
  handlers: {
    onChunk: (content: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  },
  model = DEFAULT_QWEN_MODEL,
  schemaContext?: string,
): () => void {
  const controller = new AbortController();

  void (async () => {
    try {
      let response: Response | undefined;
      let lastError: unknown;
      for (const baseUrl of OLLAMA_BASE_URLS) {
        try {
          response = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: buildSystemPrompt(schemaContext) },
                ...messages.filter((m) => m.role !== "system"),
              ],
              stream: true,
              options: { temperature: 0.6, num_predict: 2048 },
            }),
            signal: controller.signal,
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("Ollama에 연결할 수 없습니다.");
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Ollama chat 요청 실패 (${response.status})`);
      }
      if (!response.body) throw new Error("Ollama 스트리밍 응답이 비어 있습니다.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = JSON.parse(trimmed) as OllamaStreamLine;
          if (parsed.error) throw new Error(parsed.error);
          const content = parsed.message?.content ?? "";
          if (content) handlers.onChunk(content);
          if (parsed.done) {
            handlers.onDone();
            return;
          }
        }
      }
      handlers.onDone();
    } catch (error) {
      if (controller.signal.aborted) return;
      handlers.onError(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
      handlers.onDone();
    }
  })();

  return () => controller.abort();
}

export function streamQwenChat(
  messages: OllamaChatMessage[],
  handlers: {
    onChunk: (content: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  },
  model = DEFAULT_QWEN_MODEL,
  schemaContext?: string,
): () => void {
  const port = openPort();
  let fallbackCancel: (() => void) | undefined;

  port.onMessage.addListener((msg: BackgroundResponse) => {
    if (msg.type === "CHAT_CHUNK") {
      if (msg.content) handlers.onChunk(msg.content);
      if (msg.done) {
        complete();
        port.disconnect();
      }
    }
    if (msg.type === "CHAT_ERROR") {
      const err = msg as ChatStreamError;
      if (shouldTryDirectFallback(err.error)) {
        port.disconnect();
        fallbackCancel = streamQwenChatDirect(messages, handlers, model, schemaContext);
        return;
      }
      handlers.onError(err.error);
      complete();
      port.disconnect();
    }
  });

  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    handlers.onDone();
  };

  port.onDisconnect.addListener(() => {
    complete();
  });

  port.postMessage({
    type: "CHAT_STREAM",
    messages,
    model,
    schemaContext,
  });

  return () => {
    fallbackCancel?.();
    port.disconnect();
  };
}
