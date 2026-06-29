import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const AVATAR_DIR = process.env.OPENCLAW_DIR
  ? path.join(process.env.OPENCLAW_DIR, "media")
  : "/home/node/.openclaw/media";

const AVATAR_PATH = path.join(AVATAR_DIR, "avatar.jpg");
const AVATAR_URL = `/api/media${AVATAR_PATH}`;

function isAuthenticated(request: NextRequest): boolean {
  return request.cookies.get("mc_auth")?.value === process.env.AUTH_SECRET;
}

export async function GET() {
  if (!existsSync(AVATAR_PATH)) {
    return NextResponse.json({ url: null });
  }
  return NextResponse.json({ url: AVATAR_URL });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 400 });
    }

    if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });

    const bytes = await file.arrayBuffer();
    writeFileSync(AVATAR_PATH, Buffer.from(bytes));

    return NextResponse.json({ url: AVATAR_URL + "?t=" + Date.now() });
  } catch (err) {
    console.error("Avatar upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
