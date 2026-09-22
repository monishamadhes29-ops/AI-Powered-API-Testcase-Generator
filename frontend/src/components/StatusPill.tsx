export function StatusPill({
  tone, children, title
}: { tone: "success" | "danger" | "warning" | "neutral"; children: React.ReactNode; title?: string }) {
  return <span className={`status-pill ${tone}`} title={title}>{children}</span>;
}
