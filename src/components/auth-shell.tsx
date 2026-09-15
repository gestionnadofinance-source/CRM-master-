export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-fg">
            CM
          </div>
          <h1 className="text-xl font-semibold text-text">CRM Master</h1>
          <p className="mt-1 text-sm text-muted">Gestion commerciale interne</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
