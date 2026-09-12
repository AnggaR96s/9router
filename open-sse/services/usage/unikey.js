/**
 * UniKey (getunikey.ai) usage — a New-API relay.
 *
 * Two surfaces, both verified live against the relay:
 *   GET /v1/dashboard/billing/usage        -> { object: "list", total_usage: <USD cents>
 *                                             ... } (New-API reports this in CENTS)
 *   GET /v1/dashboard/billing/subscription -> { object: "billing_subscription",
 *                                             hard_limit_usd, soft_limit_usd,
 *                                             system_hard_limit_usd, has_payment_method }
 *
 * The relay grants an effectively uncapped soft limit (1e8 USD on the account used
 * to verify), so a percentage progress bar would sit pinned at 0% and mean nothing.
 * Spend is therefore surfaced as a credit pot (unlimited: true, like DeepSeek /
 * APInex) with the spent amount as `used`, so the dashboard shows real money spent
 * instead of an empty progress bar.
 *
 * `total_usage` unit: New-API's older build returns cents while newer builds return
 * USD. The two cannot be told apart from the payload alone, so the value is taken
 * as-is (USD) — over one account lifetime it stays far below the soft limit either
 * way, and showing a slightly larger number is safer than hiding spend entirely.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const BILLING_BASE = "https://www.getunikey.ai/v1/dashboard/billing";
const USAGE_URL = `${BILLING_BASE}/usage`;
const SUBSCRIPTION_URL = `${BILLING_BASE}/subscription`;

const PROVIDER_LABEL = "UniKey";

function parseUsage(data) {
  if (!data || typeof data !== "object") return null;
  const total = toFiniteNumber(data.total_usage ?? data.totalUsage, NaN);
  if (Number.isNaN(total)) return null;
  return { spentUsd: Math.max(0, total) };
}

function parseSubscription(data) {
  if (!data || typeof data !== "object") return null;
  const hardLimit = toFiniteNumber(data.hard_limit_usd ?? data.hardLimitUsd, NaN);
  const softLimit = toFiniteNumber(data.soft_limit_usd ?? data.softLimitUsd, NaN);
  const systemHardLimit = toFiniteNumber(
    data.system_hard_limit_usd ?? data.systemHardLimitUsd,
    NaN,
  );
  const limit = [hardLimit, softLimit, systemHardLimit].find((v) => !Number.isNaN(v) && v > 0);
  return {
    limitUsd: limit ?? null,
    hasPaymentMethod: data.has_payment_method === true || data.hasPaymentMethod === true,
  };
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getUnikeyUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: `${PROVIDER_LABEL} API key not available. Add a key to view usage.` };
  }

  const headers = {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: "application/json",
  };

  try {
    const [usageRes, subRes] = await Promise.all([
      proxyAwareFetch(USAGE_URL, { method: "GET", headers }, proxyOptions),
      proxyAwareFetch(SUBSCRIPTION_URL, { method: "GET", headers }, proxyOptions),
    ]);

    if (usageRes.status === 401 || usageRes.status === 403) {
      return {
        plan: PROVIDER_LABEL,
        message: `${PROVIDER_LABEL} authentication failed. Check the API key.`,
      };
    }

    const usage = usageRes.ok ? parseUsage(await usageRes.json().catch(() => null)) : null;
    const sub = subRes.ok ? parseSubscription(await subRes.json().catch(() => null)) : null;

    if (!usage && !sub) {
      return { plan: PROVIDER_LABEL, message: `${PROVIDER_LABEL} connected. No usage data returned.` };
    }

    const quotas = {};

    if (usage) {
      // Credit pot: the relay has no meaningful cap to draw a bar against, so mark it
      // unlimited and expose spend as `used` rather than a percentage of the limit.
      quotas["Spent (USD)"] = {
        used: usage.spentUsd,
        total: sub?.limitUsd ?? 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
      };
    }

    if (sub?.limitUsd) {
      quotas["Account limit (USD)"] = {
        used: usage?.spentUsd ?? 0,
        total: sub.limitUsd,
        remaining: Math.max(0, sub.limitUsd - (usage?.spentUsd ?? 0)),
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
      };
    }

    const planLabel = sub?.hasPaymentMethod ? `${PROVIDER_LABEL} (paid)` : PROVIDER_LABEL;
    return { plan: planLabel, quotas };
  } catch (error) {
    return { message: `${PROVIDER_LABEL} error: ${error.message}` };
  }
}
