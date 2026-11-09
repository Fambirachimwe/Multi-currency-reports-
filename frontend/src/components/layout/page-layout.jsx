/**
 * Standard page frame with layout slots:
 * - title: compact heading with the short accent underline from ui-context.md
 * - description: optional supporting text
 * - actions: optional toolbar area aligned right of the title
 * - children: page body
 */
export function PageLayout({ title, description, actions, children }) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="w-fit border-b-2 border-accent-primary pb-1 text-lg font-semibold text-text-primary">
            {title}
          </h1>
          {description ? <p className="text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
