export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type OllamaChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatStreamRequest = {
  type: "CHAT_STREAM";
  messages: OllamaChatMessage[];
  model?: string;
  /** Dremio 카탈로그에서 실시간으로 읽은 스키마 컨텍스트 */
  schemaContext?: string;
};

export type ChatStreamChunk = {
  type: "CHAT_CHUNK";
  content: string;
  done: boolean;
};

export type ChatStreamError = {
  type: "CHAT_ERROR";
  error: string;
};

export type HealthCheckRequest = {
  type: "HEALTH_CHECK";
};

export type HealthCheckResponse = {
  type: "HEALTH_OK";
  model: string;
  models: string[];
};

export type HealthCheckError = {
  type: "HEALTH_ERROR";
  error: string;
};

export type BackgroundRequest = ChatStreamRequest | HealthCheckRequest;
export type BackgroundResponse =
  | ChatStreamChunk
  | ChatStreamError
  | HealthCheckResponse
  | HealthCheckError;
