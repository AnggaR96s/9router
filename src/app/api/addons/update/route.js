import { NextResponse } from "next/server";
import { checkAndUpdateSkill, checkSkillStatus } from "@/lib/addonUpdater";

export const dynamic = "force-dynamic";

// POST {id} — check + update one addon skill prompt
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { id } = body;
    if (!id || typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid skill id" }, { status: 400 });
    }
    const result = await checkAndUpdateSkill(id);
    return NextResponse.json(result);
  } catch (error) {
    const isClientErr = error.message?.includes("not found") || error.message?.includes("not whitelisted");
    return NextResponse.json(
      { error: error.message || "Update failed" },
      { status: isClientErr ? 400 : 500 }
    );
  }
}

// GET?id= — status only, no write
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id || !/^[a-z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid skill id" }, { status: 400 });
    }
    const result = await checkSkillStatus(id);
    return NextResponse.json(result);
  } catch (error) {
    const isClientErr = error.message?.includes("not found") || error.message?.includes("not whitelisted");
    return NextResponse.json(
      { error: error.message || "Status check failed" },
      { status: isClientErr ? 400 : 500 }
    );
  }
}
