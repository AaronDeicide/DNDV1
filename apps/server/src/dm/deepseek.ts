import { config } from "../config";
import { getSetting } from "../admin";
import { parseSse } from "./sse";
import type { DmProvider, DmGenerateParams, DmGenerateResult } from "./types";

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
};

type ChatCompletionResponse = {
  choices: Array<{
    message: { content: string | null };
  }>;
};

export class DeepSeekProvider implements DmProvider {
  async generate(params: DmGenerateParams): Promise<DmGenerateResult> {
    // 允许通过后台 Settings 覆盖 env（env 作为默认值）
    const apiKey = await getSetting<string>("deepseek.apiKey", config.deepseek.apiKey);
    const baseUrl = await getSetting<string>("deepseek.baseUrl", config.deepseek.baseUrl);
    const model = await getSetting<string>("deepseek.model", config.deepseek.model);

    if (!apiKey) throw new Error("未配置 DeepSeek API Key（可在后台设置）");

    const url = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
    const body: any = {
      model,
      messages: params.messages,
      stream: params.stream
    };

    if (params.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!params.stream) {
      if (!resp.ok) throw new Error(`DeepSeek HTTP ${resp.status}: ${await resp.text()}`);
      const json = (await resp.json()) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content ?? "";
      return { content, raw: json };
    }

    let content = "";
    await parseSse(resp, (data) => {
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as ChatCompletionChunk;
        const delta = json.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          content += delta;
          params.onDelta?.(delta);
        }
      } catch {
        // 忽略非 JSON 的 data
      }
    });

    return { content };
  }
}
