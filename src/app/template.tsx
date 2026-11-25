/**
 * page transition: a short CSS fade + rise on every route change.
 * CSS (not JS) so server-rendered content shows even before hydration.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-1 flex-col">{children}</div>;
}
