import { NextResponse } from "next/server";
import { getProviderConnections, getProxyPoolById, getProxyPools } from "@/models";
import { bulkSetConnectionProxyPool } from "@/lib/db/repos/connectionsRepo.js";
import { BULK_PROXY_MODES, planProxyAssignments } from "@/shared/utils/bulkProxyAssign";

/**
 * POST /api/providers/bulk-proxy — bind or clear a proxy pool on many
 * connections in ONE request and ONE transaction.
 *
 * The dashboard used to do this client-side with a PUT per connection in a
 * sequential loop: applying a pool to 500 accounts was 500 round trips and 500
 * transactions, tens of seconds of dead UI, and a mid-way failure left half the
 * accounts applied with no way to tell which. Moving the loop to the server and
 * collapsing it into a transaction makes the whole batch atomic, and the client
 * gets a single count back.
 *
 * Body:
 *   {
 *     provider: "tokenharbor",        // required — scopes the batch
 *     mode: "single" | "one-to-one",  // default "single"
 *     proxyPoolId: "<id>"|null,       // mode "single": null/"__none__" = unbind
 *     connectionIds: ["..."]          // optional; omit = every connection
 *   }
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: `Invalid JSON body: ${err.message}` }, { status: 400 });
  }

  const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const mode = body?.mode === BULK_PROXY_MODES.ONE_TO_ONE
    ? BULK_PROXY_MODES.ONE_TO_ONE
    : BULK_PROXY_MODES.SINGLE;

  try {
    const all = await getProviderConnections({ provider });

    // Optional subset — the dashboard may send only the checked rows. Ids that
    // are not this provider's connections are ignored rather than erroring, so
    // a stale selection cannot fail the whole batch.
    const wanted = Array.isArray(body?.connectionIds) && body.connectionIds.length > 0
      ? new Set(body.connectionIds.map(String))
      : null;
    const scoped = wanted ? all.filter((c) => wanted.has(String(c.id))) : all;

    if (scoped.length === 0) {
      return NextResponse.json({ updated: 0, unchanged: 0, total: 0, missing: [] });
    }

    // Validate the pool up front: a bulk write that half-succeeds on a bogus id
    // is worse than refusing outright.
    let activePoolIds = [];
    if (mode === BULK_PROXY_MODES.ONE_TO_ONE) {
      const pools = await getProxyPools();
      activePoolIds = (pools || []).filter((p) => p.isActive === true).map((p) => p.id);
    } else if (body?.proxyPoolId) {
      const pool = await getProxyPoolById(String(body.proxyPoolId));
      if (!pool) {
        return NextResponse.json({ error: "Proxy pool not found" }, { status: 400 });
      }
    }

    const plan = planProxyAssignments(scoped, {
      mode,
      proxyPoolId: body?.proxyPoolId ?? null,
      activePoolIds,
    });

    if (plan.error) {
      return NextResponse.json({ error: plan.error }, { status: 400 });
    }

    if (plan.targets.length === 0) {
      return NextResponse.json({
        updated: 0,
        unchanged: plan.unchanged,
        total: plan.total,
        missing: [],
      });
    }

    const { updated, missing } = await bulkSetConnectionProxyPool(plan.targets);

    return NextResponse.json({
      updated,
      unchanged: plan.unchanged,
      total: plan.total,
      missing,
    });
  } catch (error) {
    console.log("Error applying bulk proxy:", error);
    return NextResponse.json({ error: "Failed to apply proxy" }, { status: 500 });
  }
}
