/**
 * 最小 SSE 解析器（仅处理 `data:` 行）。
 * DeepSeek 的 stream=true 响应为 SSE，终止行为：`data: [DONE]`
 */
export async function parseSse(
  resp: Response,
  onData: (data: string) => void,
  opts?: { signal?: AbortSignal }
) {
  if (!resp.ok) {
    const text = await safeReadText(resp);
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  if (!resp.body) throw new Error("响应无 body（无法流式读取）");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 以 \n 分行（这里用宽松策略）
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);

      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice("data:".length).trim();
      onData(data);
    }
  }
}

async function safeReadText(resp: Response) {
  try {
    return await resp.text();
  } catch {
    return "<no body>";
  }
}

