type NavigationItem = { id: string; href: string };

/** Select only from the navigation items already made visible by the server. */
export function getActiveOfficeNavigationItem<Item extends NavigationItem>(
  groups: readonly { items: readonly Item[] }[],
  pathname: string,
): Item | undefined {
  const routePath = pathname.split(/[?#]/, 1)[0]!;
  const visibleItems = groups.flatMap((group) => group.items);
  const activeItem = visibleItems
    .filter((item) => isNavigationItemActive(item, routePath))
    .sort((left, right) => right.href.length - left.href.length)[0];
  if (activeItem) return activeItem;
  if (
    /^\/(?:billing\/settings|billing\/claims\/settings|operations\/reminder-settings)\/?$/.test(
      routePath,
    )
  )
    return visibleItems.find((item) => item.id === 'administration');
  return undefined;
}

function isNavigationItemActive(item: NavigationItem, pathname: string) {
  // The App Router has /visits/[id], not a /visits section or deeper visit routes.
  if (item.id === 'planning' && /^\/visits\/[^/]+\/?$/.test(pathname)) return true;
  if (item.id === 'overview') return pathname === '/operations';
  if (item.id === 'operations' && pathname.startsWith('/operations/')) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
