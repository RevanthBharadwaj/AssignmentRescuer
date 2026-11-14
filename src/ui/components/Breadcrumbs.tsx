import { useApp, type Route } from '../AppContext';

export interface Crumb {
  label: string;
  route?: Route;
}

/** Canvas-style trail: Home › Courses › BUS 610 › Assignments › Paper 1 */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const { go } = useApp();
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${c.label}-${i}`}>
              {!last && c.route ? (
                <button type="button" className="crumb" onClick={() => go(c.route as Route)}>{c.label}</button>
              ) : (
                <span className="crumb current" aria-current={last ? 'page' : undefined}>{c.label}</span>
              )}
              {!last && <span className="sep" aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
