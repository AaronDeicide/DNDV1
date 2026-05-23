import { DeepSeekProvider } from "./deepseek";
import type { DmProvider } from "./types";

let provider: DmProvider | null = null;

export function getDmProvider(): DmProvider {
  if (!provider) provider = new DeepSeekProvider();
  return provider;
}

