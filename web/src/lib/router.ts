import * as React from 'react';

/**
 * Minimal hash-based router: returns the current path (without leading '#').
 * Examples:
 *   ''        -> '/'
 *   '#/'      -> '/'
 *   '#/awards' -> '/awards'
 *   '#/admin/users' -> '/admin/users'
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
