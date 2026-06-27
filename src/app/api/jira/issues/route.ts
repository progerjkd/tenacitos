import { NextResponse } from "next/server";
import { getProjectIssues } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const issues = await getProjectIssues("NEURALOPS");
    return NextResponse.json({ issues });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch Jira issues";
    console.error("Jira error:", error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
