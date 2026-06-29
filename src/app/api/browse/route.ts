import { NextRequest, NextResponse } from "next/server";
import { promises as fs, readFileSync } from "fs";
import path from "path";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/root/.openclaw";

interface FileEntry {
  name: string;
  type: "file" | "folder";
  size: number;
  modified: string;
}

function resolveWorkspacePath(workspace: string): string {
  if (workspace === "workspace") return path.join(OPENCLAW_DIR, "workspace");
  if (workspace.startsWith("workspace-")) return path.join(OPENCLAW_DIR, workspace);
  if (workspace.startsWith("agent-")) {
    const agentId = workspace.replace("agent-", "");
    try {
      const config = JSON.parse(readFileSync(path.join(OPENCLAW_DIR, "openclaw.json"), "utf-8"));
      const agent = (config?.agents?.list as Array<{ id: string; workspace?: string }>)?.find(a => a.id === agentId);
      if (agent?.workspace) return agent.workspace;
    } catch {}
  }
  return path.join(OPENCLAW_DIR, workspace);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const workspace = searchParams.get("workspace") || "workspace";
    const relativePath = searchParams.get("path") || "";
    const fileContent = searchParams.get("content") === "true";
    const rawMode = searchParams.get("raw") === "true";

    // Determine BASE_PATH based on workspace
    const BASE_PATH = resolveWorkspacePath(workspace);
    
    // Validate workspace exists
    try {
      await fs.access(BASE_PATH);
    } catch {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }
    
    // Normalize and validate path to prevent directory traversal
    const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
    const fullPath = path.join(BASE_PATH, normalizedPath);
    
    // Ensure the path is within BASE_PATH
    if (!fullPath.startsWith(BASE_PATH)) {
      return NextResponse.json(
        { error: "Access denied: Path outside workspace" },
        { status: 403 }
      );
    }

    const stats = await fs.stat(fullPath);

    // Serve raw file (for images etc.)
    if (rawMode && stats.isFile()) {
      const ext = path.extname(fullPath).toLowerCase().slice(1);
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        ico: "image/x-icon",
      };
      const contentType = mimeTypes[ext];
      if (!contentType) {
        return NextResponse.json(
          { error: "Raw mode only supports image files" },
          { status: 400 }
        );
      }
      const buffer = await fs.readFile(fullPath);
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": buffer.length.toString(),
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // If requesting file content
    if (fileContent && stats.isFile()) {
      const content = await fs.readFile(fullPath, "utf-8");
      return NextResponse.json({
        name: path.basename(fullPath),
        path: normalizedPath,
        content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    }

    // If it's a directory, list contents
    if (stats.isDirectory()) {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      const items: FileEntry[] = await Promise.all(
        entries
          .filter((entry) => !entry.name.startsWith(".")) // Hide hidden files
          .map(async (entry) => {
            const entryPath = path.join(fullPath, entry.name);
            const entryStats = await fs.stat(entryPath).catch(() => null);
            
            return {
              name: entry.name,
              type: entry.isDirectory() ? "folder" : "file",
              size: entryStats?.size || 0,
              modified: entryStats?.mtime.toISOString() || new Date().toISOString(),
            } as FileEntry;
          })
      );

      // Sort: folders first, then by name
      items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return NextResponse.json({
        path: normalizedPath,
        items,
      });
    }

    // Single file info
    return NextResponse.json({
      name: path.basename(fullPath),
      path: normalizedPath,
      type: "file",
      size: stats.size,
      modified: stats.mtime.toISOString(),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "Path not found" },
        { status: 404 }
      );
    }
    console.error("Browse API error:", error);
    return NextResponse.json(
      { error: "Failed to browse path" },
      { status: 500 }
    );
  }
}
