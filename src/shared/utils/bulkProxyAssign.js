/**
 * Planning for the dashboard's "Apply Proxy" bulk action.
 *
 * Split out of the route so the two decisions the bulk endpoint makes — which
 * pool each connection gets, and which connections need no write at all — are
 * testable without a database or an HTTP layer.
 */

export const BULK_PROXY_MODES = {
  /** Every connection gets the same pool (or none, to unbind). */
  SINGLE: "single",
  /** Active pools are spread across connections in rotation. */
  ONE_TO_ONE: "one-to-one",
};

/**
 * Build the per-connection proxy assignment plan.
 *
 * `unchanged` matters as much as `targets`: re-applying the pool a connection
 * already has is a no-op, and skipping those rows is what makes a repeat apply
 * cost nothing instead of rewriting N rows to the same value.
 *
 * @param {{id: string, providerSpecificData?: {proxyPoolId?: string|null}}[]} connections
 * @param {{mode?: string, proxyPoolId?: string|null, activePoolIds?: string[]}} options
 * @returns {{targets: {id: string, proxyPoolId: string|null}[], unchanged: number, total: number, error: string|null}}
 */
export function planProxyAssignments(connections, options = {}) {
  const list = (Array.isArray(connections) ? connections : []).filter((c) => c && c.id);
  const total = list.length;
  const empty = { targets: [], unchanged: 0, total, error: null };

  if (total === 0) return empty;

  if (options.mode === BULK_PROXY_MODES.ONE_TO_ONE) {
    const pools = (Array.isArray(options.activePoolIds) ? options.activePoolIds : []).filter(Boolean);
    if (pools.length === 0) {
      return { ...empty, error: "No active proxy pools available." };
    }
    return {
      targets: list.map((c, i) => ({ id: c.id, proxyPoolId: pools[i % pools.length] })),
      unchanged: 0,
      total,
      error: null,
    };
  }

  // SINGLE: null/""/"__none__" all mean "unbind", matching the per-row PUT's
  // normalizeProxyPoolUpdate so bulk and single leave identical stored state.
  const raw = options.proxyPoolId;
  const pool = raw === null || raw === undefined || raw === "" || raw === "__none__"
    ? null
    : String(raw).trim() || null;

  const targets = [];
  let unchanged = 0;
  for (const c of list) {
    const current = c.providerSpecificData?.proxyPoolId || null;
    if (current === pool) {
      unchanged += 1;
      continue;
    }
    targets.push({ id: c.id, proxyPoolId: pool });
  }

  return { targets, unchanged, total, error: null };
}
