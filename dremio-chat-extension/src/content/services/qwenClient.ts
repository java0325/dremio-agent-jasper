import { DEFAULT_QWEN_MODEL } from "../../shared/config";
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

export async function checkOllamaHealth(): Promise<{
  ok: boolean;
  model: string;
  error?: string;
}> {
  return new Promise((resolve) => {
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

  return () => port.disconnect();
}
