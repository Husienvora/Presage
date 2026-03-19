import { PREDICT_API_BASE } from "./constants";
import type { PredictCategory, PredictMarket } from "../types";

const API_KEY = import.meta.env.VITE_PREDICT_API_KEY || "";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

/** Fetch open categories with their markets embedded */
export async function fetchCategories(limit = 12): Promise<PredictCategory[]> {
  if (!API_KEY) return [];
  try {
    const res = await fetch(
      `${PREDICT_API_BASE}/categories?status=OPEN&first=${limit}`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((c: any) => ({
      title: c.title || "",
      slug: c.slug || "",
      endsAt: c.endsAt || "",
      status: c.status || "",
      isNegRisk: c.isNegRisk || false,
      isYieldBearing: c.isYieldBearing || false,
      markets: (c.markets || []).map((m: any) => ({
        id: m.id,
        title: m.title || m.question || "",
        conditionId: m.conditionId || "",
        outcomes: (m.outcomes || []).map((o: any) => ({
          name: o.name || o.title || "?",
          onChainId: o.onChainId || "",
        })),
        isNegRisk: m.isNegRisk ?? c.isNegRisk ?? false,
        isYieldBearing: m.isYieldBearing ?? c.isYieldBearing ?? false,
      })),
    }));
  } catch {
    return [];
  }
}

/** Fetch flat market list (fallback) */
export async function fetchMarkets(limit = 20): Promise<PredictMarket[]> {
  if (!API_KEY) return [];
  try {
    const res = await fetch(
      `${PREDICT_API_BASE}/markets?status=OPEN&first=${limit}`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m: any) => ({
      id: m.id,
      title: m.title || "",
      conditionId: m.conditionId || "",
      outcomes: (m.outcomes || []).map((o: any) => ({
        name: o.name || o.title || "?",
        onChainId: o.onChainId || "",
      })),
      isNegRisk: m.isNegRisk || false,
      isYieldBearing: m.isYieldBearing || false,
    }));
  } catch {
    return [];
  }
}

export function hasApiKey(): boolean {
  return API_KEY.length > 0;
}
