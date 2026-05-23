import { getSetting } from "./admin";

export async function resolveAssetUrl(url: string) {
  const base = (await getSetting<string>("assets.baseUrl", "")).replace(/\/$/, "");
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!base) return raw;
  return `${base}/${raw.replace(/^\//, "")}`;
}

