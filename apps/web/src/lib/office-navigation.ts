type NavigationItem = { id: string; href: string };

/** Select only from the navigation items already made visible by the server. */
export function getActiveOfficeNavigationItem<Item extends NavigationItem>(
  groups: readonly { items: readonly Item[] }[],
  pathname: string,
): Item | undefined {
  const routePath = pathname.split(/[?#]/, 1)[0]!;
  return groups
    .flatMap((group) => group.items)
    .filter((item) => isNavigationItemActive(item, routePath))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

function isNavigationItemActive(item: NavigationItem, pathname: string) {
  // The App Router has /visits/[id], not a /visits section or deeper visit routes.
  if (item.id === 'planning' && /^\/visits\/[^/]+\/?$/.test(pathname)) return true;
  if (item.id === 'overview') return pathname === '/operations';
  if (item.id === 'operations' && pathname.startsWith('/operations/')) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
