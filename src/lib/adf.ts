// Jira Cloud text fields (comment bodies, etc.) normally arrive as plain strings, but can also
// arrive in Atlassian Document Format (nested content[].content[].text) — handle both defensively.
export function extractPlainText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (typeof obj.text === "string") texts.push(obj.text);
        if (obj.content) walk(obj.content);
      }
    };
    walk(body);
    return texts.join(" ");
  }
  return "";
}
