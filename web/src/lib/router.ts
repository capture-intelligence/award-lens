import * as React from 'react';

/**
 * @deprecated Use `useNavigate()` from react-router-dom for navigation and
 * `useLocation()` for the current path. This module remains only so legacy
 * pages (BrowseViews, AdminViews, ViewSelector, NoViewSelected) compile
 * during the views-feature sunset; those pages are no longer mounted.
 *
 * Minimal hash-based router: returns the current path (without leading '#').
 */
export function useHashRoute(): string {
  const [route, setRoute] = React.useState<string>(() => parse(window.location.hash));

  React.useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

function parse(hash: string): string {
  const stripped = hash.replace(/^#/, '');
  if (!stripped) return '/';
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

export function navigate(path: string) {
  const target = path.startsWith('/') ? path : `/${path}`;
  window.location.hash = `#${target}`;
}
