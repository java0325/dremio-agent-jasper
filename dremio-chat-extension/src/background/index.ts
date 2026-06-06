import { buildSystemPrompt, DEFAULT_QWEN_MODEL, OLLAMA_BASE_URL } from "../shared/config";
import type {
  BackgroundRequest,
  ChatStreamChunk,
  ChatStreamError,
  HealthCheckError,
  HealthCheckResponse,
  OllamaChatMessage,
} from "../shared/types";

const CHAT_PORT = "qwen-chat";

type OllamaTagsResponse = {
  models?: Array<{ name: string }>;
};

type OllamaStreamLine = {
  message?: { content?: string };
  done?: boolean;
  error?: string;
};

async function fetchAvailableModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama 응답 오류 (${res.status})`);
  const data = (await res.json()) as OllamaTagsResponse;
  return (data.models ?? []).map((m) => m.name);
}

async function streamChat(
  messages: OllamaChatMessage[],
  model: string,
  schemaContext: string | undefined,
  onChunk: (chunk: ChatStreamChunk) => void,
): Promise<void> {
  const systemPrompt = buildSystemPrompt(schemaContext);

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.filter((m) => m.role !== "system"),
    ],
    stream: true,
    options: { temperature: 0.6, num_predict: 2048 },
  };

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text ||
        `Ollama chat 요청 실패 (${response.status}). 모델이 설치되었는지 확인하세요: ollama pull ${model}`,
    );
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
      if (content) onChunk({ type: "CHAT_CHUNK", content, done: false });
      if (parsed.done) {
        onChunk({ type: "CHAT_CHUNK", content: "", done: true });
        return;
      }
    }
  }
  onChunk({ type: "CHAT_CHUNK", content: "", done: true });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHAT_PORT) return;

  port.onMessage.addListener((raw: BackgroundRequest) => {
    if (raw.type === "HEALTH_CHECK") {
      void (async () => {
        try {
          const models = await fetchAvailableModels();
          const hasModel = models.some(
            (n) =>
              n === DEFAULT_QWEN_MODEL ||
              n.startsWith(`${DEFAULT_QWEN_MODEL}:`),
          );
          if (!hasModel) {
            const err: HealthCheckError = {
              type: "HEALTH_ERROR",
              error: `Qwen 모델이 없습니다. 터미널에서 실행: ollama pull ${DEFAULT_QWEN_MODEL}`,
            };
            port.postMessage(err);
            return;
          }
          const ok: HealthCheckResponse = {
            type: "HEALTH_OK",
            model: DEFAULT_QWEN_MODEL,
            models,
          };
          port.postMessage(ok);
        } catch (error) {
          const err: HealthCheckError = {
            type: "HEALTH_ERROR",
            error:
              error instanceof Error
                ? error.message
                : "Ollama에 연결할 수 없습니다. Ollama 앱을 실행하세요.",
          };
          port.postMessage(err);
        }
      })();
      return;
    }

    if (raw.type === "CHAT_STREAM") {
      void (async () => {
        try {
          await streamChat(
            raw.messages,
            raw.model ?? DEFAULT_QWEN_MODEL,
            raw.schemaContext,
            (chunk) => port.postMessage(chunk),
          );
        } catch (error) {
          const err: ChatStreamError = {
            type: "CHAT_ERROR",
            error:
              error instanceof Error
                ? error.message
                : "알 수 없는 오류가 발생했습니다.",
          };
          port.postMessage(err);
        }
      })();
    }
  });
});
