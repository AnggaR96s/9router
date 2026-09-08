/**
 * APInex usage — GET https://api.apinex.bond/v1/balance + /v1/subscription
 * Auth: Bearer <apiKey> (sk-apx...)
 * One USD wallet for all models/tools; free tier gives a daily token allowance.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const BALANCE_URL = "https://api.apinex.bond/v1/balance";
const SUBSCRIPTION_URL = "https://api.apinex.bond/v1/subscription";

function parseBalance(data) {
  if (!data || typeof data !== "object") return null;
  const balanceUsd = toFiniteNumber(data.balance_usd ?? data.balanceUsd, 0);
  const reservedUsd = toFiniteNumber(data.reserved_usd ?? data.reservedUsd, 0);
  const key = data.api_key && typeof data.api_key === "object" ? data.api_key : null;
  return {
    balanceUsd,
    reservedUsd,
    key: key
      ? {
          spentUsd: toFiniteNumber(key.spent_usd ?? key.spentUsd, 0),
          limitUsd: key.spend_limit_usd ?? key.spendLimitUsd ?? null,
          remainingUsd: key.remaining_usd ?? key.remainingUsd ?? null,
          limitReached: key.limit_reached === true || key.limitReached === true,
        }
      : null,
  };
}

function parseSubscription(data) {
  if (!data || typeof data !== "object") return null;
  const tokenLimit = toFiniteNumber(data.token_limit ?? data.tokenLimit, 0);
  const tokensUsed = toFiniteNumber(data.tokens_used ?? data.tokensUsed, 0);
  const tokensRemaining =
    data.tokens_remaining ?? data.tokensRemaining ?? null;
  return {
    mode: data.mode === "subscription" ? "subscription" : "free",
    plan: data.plan || null,
    planLabel: data.plan_label || data.planLabel || "FREE",
    tokenLimit,
    tokensUsed,
    tokensRemaining:
      tokensRemaining === null || tokensRemaining === undefined
        ? Math.max(0, tokenLimit - tokensUsed)
        : toFiniteNumber(tokensRemaining, 0),
    unlimited: data.unlimited === true,
    allowed: data.allowed !== false,
    resetsAt: data.resets_at_utc || data.resetsAtUtc || null,
  };
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getApinexUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "APInex API key not available. Add a key to view usage." };
  }

  const headers = {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: "application/json",
  };

  try {
    const [balanceRes, subRes] = await Promise.all([
      proxyAwareFetch(BALANCE_URL, { method: "GET", headers }, proxyOptions),
      proxyAwareFetch(SUBSCRIPTION_URL, { method: "GET", headers }, proxyOptions),
    ]);

    if (balanceRes.status === 401 || balanceRes.status === 403) {
      return {
        plan: "APInex",
        message: "APInex authentication failed. Check the API key.",
      };
    }

    const balance = balanceRes.ok
      ? parseBalance(await balanceRes.json().catch(() => null))
      : null;
    const sub = subRes.ok
      ? parseSubscription(await subRes.json().catch(() => null))
      : null;

    if (!balance && !sub) {
      return {
        plan: "APInex",
        message: "APInex connected. No usage data returned.",
      };
    }

    const quotas = {};

    // Wallet balance — no fixed cap, so treat as a credit pot (like DeepSeek).
    if (balance) {
      const walletTotal = Math.max(0, balance.balanceUsd);
      quotas["Wallet (USD)"] = {
        used: 0,
        total: walletTotal,
        remainingPercentage: walletTotal > 0 ? 100 : 0,
        resetAt: null,
        unlimited: walletTotal > 0,
      };
      if (balance.reservedUsd > 0) {
        quotas["Reserved (USD)"] = {
          used: balance.reservedUsd,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        };
      }
      // Per-key lifetime spend / limit, when a limit is configured.
      if (balance.key?.limitUsd !== null && balance.key?.limitUsd !== undefined) {
        const limit = Math.max(0, balance.key.limitUsd);
        const spent = Math.max(0, balance.key.spentUsd);
        quotas["Key spend (USD)"] = {
          used: spent,
          total: limit,
          remaining: Math.max(0, limit - spent),
          remainingPercentage: limit > 0 ? Math.min(100, ((limit - spent) / limit) * 100) : 0,
          resetAt: null,
          unlimited: false,
        };
      }
    }

    // Free-tier daily token allowance.
    if (sub && sub.tokenLimit > 0) {
      quotas[sub.mode === "subscription" ? "Plan tokens" : "Daily tokens"] = {
        used: sub.tokensUsed,
        total: sub.tokenLimit,
        remaining: sub.tokensRemaining,
        remainingPercentage: sub.unlimited
          ? 100
          : Math.min(100, Math.max(0, (sub.tokensRemaining / sub.tokenLimit) * 100)),
        resetAt: sub.resetsAt || null,
        unlimited: sub.unlimited,
      };
    }

    const plan = sub
      ? sub.planLabel || (sub.mode === "subscription" ? "Subscription" : "FREE")
      : "APInex";

    return {
      plan,
      quotas,
      ...(sub && !sub.allowed ? { message: "APInex quota exhausted (allowed=false)." } : {}),
    };
  } catch (error) {
    return { message: `APInex error: ${error.message}` };
  }
}