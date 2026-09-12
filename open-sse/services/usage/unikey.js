/**
 * UniKey (getunikey.ai) usage — a New-API relay that bills in CREDITS.
 *
 * Units, established empirically against the relay rather than assumed:
 *   1 credit = 0.01 USD (100 credits = 1 USD)
 *   /v1/dashboard/billing/usage -> total_usage is in USD; x100 gives credits.
 * Cross-checked against the account's own dashboard: it showed 24h usage 6.58
 * credits while the API reported total_usage 0.0658, and a runway of ~758 days
 * for a 4993.42 balance (4993.42 / 6.58 = 758.9). Both agree on the x100 factor.
 *
 * What the API key CAN and CANNOT see — the reason this handler is shaped oddly:
 *   GET /v1/dashboard/billing/usage         OK -> spend                  (API key)
 *   GET /v1/dashboard/billing/subscription  OK -> limits, 1e8 USD soft  (API key)
 *   GET /api/user/self                      NO -> needs a DASHBOARD SESSION cookie
 * The remaining balance lives only behind the session endpoint; every attempt to
 * reach it with the API key (Bearer, session cookie, New-Api-User, x-api-key)
 * returns "Unauthorized, invalid access token". The subscription limits are not a
 * substitute: the relay grants a 100,000,000 USD soft limit, so a percentage bar
 * would sit pinned at 0% forever.
 *
 * Therefore: spend is reported in credits, always and accurately. Remaining is
 * derived as total - spend, where `total` comes from the OPTIONAL
 * `unikeyTotalCredits` field on the connection (providerSpecificData). That field
 * cannot be discovered by the API — it has to be read off the dashboard once — so
 * when it is absent the handler reports spend only and says why, instead of
 * inventing a balance that would silently drift.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const BILLING_BASE = "https://www.getunikey.ai/v1/dashboard/billing";
const USAGE_URL = `${BILLING_BASE}/usage`;
const SUBSCRIPTION_URL = `${BILLING_BASE}/subscription`;

const PROVIDER_LABEL = "UniKey";

// /v1/dashboard/billing/usage reports USD; the dashboard displays credits at 100x.
const CREDITS_PER_USD = 100;

// Field on providerSpecificData holding the account's lifetime credit grant, read
// once from the provider dashboard. Optional — see the header comment.
const TOTAL_CREDITS_FIELD = "unikeyTotalCredits";

function parseUsage(data) {
  if (!data || typeof data !== "object") return null;
  const total = toFiniteNumber(data.total_usage ?? data.totalUsage, NaN);
  if (Number.isNaN(total)) return null;
  return { spentUsd: Math.max(0, total), spentCredits: Math.max(0, total) * CREDITS_PER_USD };
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
 * Total credit grant from the connection's providerSpecificData, if the user set it.
 * Accepts a number or a numeric string so it works whether it was typed into a form
 * or written straight to the DB.
 * @returns {number|null}
 */
export function parseConfiguredTotalCredits(providerSpecificData) {
  if (!providerSpecificData || typeof providerSpecificData !== "object") return null;
  const raw = providerSpecificData[TOTAL_CREDITS_FIELD];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = toFiniteNumber(raw, NaN);
  if (Number.isNaN(value) || value <= 0) return null;
  return value;
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} providerSpecificData
 * @param {object|null} proxyOptions
 */
export async function getUnikeyUsage(apiKey = null, providerSpecificData = null, proxyOptions = null) {
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
      return {
        plan: PROVIDER_LABEL,
        message: `${PROVIDER_LABEL} connected. No usage data returned.`,
      };
    }

    const totalCredits = parseConfiguredTotalCredits(providerSpecificData);
    const quotas = {};

    if (usage) {
      // One row, in the provider's own unit. Spend is always accurate (it is the one
      // number the API key can read); Remaining only appears once a total is known,
      // because deriving it without one would be a guess that drifts silently.
      const spent = usage.spentCredits;
      if (totalCredits === null) {
        quotas["Spent (credits)"] = {
          used: spent,
          total: 0,
          remainingPercentage: 100,
          resetAt: null,
          unlimited: true,
        };
      } else {
        const remaining = Math.max(0, totalCredits - spent);
        quotas["Credits"] = {
          used: spent,
          total: totalCredits,
          remaining,
          remainingPercentage: Math.min(100, Math.max(0, (remaining / totalCredits) * 100)),
          resetAt: null,
          unlimited: false,
        };
      }
    }

    const planLabel = sub?.hasPaymentMethod ? `${PROVIDER_LABEL} (paid)` : PROVIDER_LABEL;
    const combined = { plan: planLabel, quotas };

    if (usage && totalCredits === null) {
      combined.message =
        `${PROVIDER_LABEL} reports spend only — the API key cannot read the remaining ` +
        `balance (it needs a dashboard session). Set "${TOTAL_CREDITS_FIELD}" on this ` +
        `connection to your total credit grant to also see Remaining.`;
    }

    return combined;
  } catch (error) {
    return { message: `${PROVIDER_LABEL} error: ${error.message}` };
  }
}
