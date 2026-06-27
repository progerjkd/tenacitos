import { NextRequest, NextResponse } from "next/server";
import { getTransitions, transitionIssue } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const { transitionName } = (await request.json()) as { transitionName?: string };

  if (!key || !/^[A-Z]+-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid issue key" }, { status: 400 });
  }

  try {
    const transitions = await getTransitions(key);
    const target = transitions.find(
      (t) =>
        t.name.toLowerCase() === (transitionName ?? "in progress").toLowerCase() ||
        t.name.toLowerCase().includes("progress"),
    );
    if (!target) {
      return NextResponse.json(
        { error: `No transition matching "${transitionName}" found` },
        { status: 404 },
      );
    }
    await transitionIssue(key, target.id);
    return NextResponse.json({ ok: true, transitionId: target.id, transitionName: target.name });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Transition failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
