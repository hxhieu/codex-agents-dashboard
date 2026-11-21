export function needsAttention(status: string): boolean {
  return ["Awaiting prompt", "Awaiting answer", "Approval requested"].includes(status);
}

export function countWaitingSessions(agents: ReadonlyArray<{ status: string }>): number {
  return agents.filter((agent) => needsAttention(agent.status)).length;
}

export function updateTabAttention(
  agents: ReadonlyArray<{ status: string }>,
  page: Pick<Document, "title" | "querySelector"> = document,
): void {
  const count = countWaitingSessions(agents);
  const title = count ? `(${count} waiting) Codex / Agents` : "Codex / Agents";
  const href = count ? "/favicon-attention.svg" : "/favicon.svg";
  if (page.title !== title) page.title = title;
  const icon = page.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon && icon.getAttribute("href") !== href) icon.setAttribute("href", href);
}
