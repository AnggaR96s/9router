import { NextResponse } from "next/server";
import { getInstalledSkills } from "@/lib/skillsRegistry";

export const dynamic = "force-dynamic";

// GET /api/addons/list — installed add-on skills (id, name, updatable, version)
export async function GET() {
  try {
    const skills = await getInstalledSkills();
    return NextResponse.json({
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        updatable: s.updatable,
        source: s.source,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list skills" }, { status: 500 });
  }
}
