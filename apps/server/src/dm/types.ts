export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type DmGenerateParams = {
  messages: LlmMessage[];
  stream: boolean;
  /**
   * JSON 输出模式：会设置 response_format 为 json_object，但仍需你在 prompt 里明确要求输出 JSON。
   */
  jsonMode?: boolean;
  onDelta?: (delta: string) => void;
};

export type DmGenerateResult = {
  content: string;
  raw?: unknown;
};

export interface DmProvider {
  generate(params: DmGenerateParams): Promise<DmGenerateResult>;
}

