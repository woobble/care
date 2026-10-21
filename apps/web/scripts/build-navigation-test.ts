import { resolve } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Expected temporary output directory');
const reactImport = JSON.stringify(Bun.resolveSync('react', resolve(import.meta.dir, '..')));
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, '../e2e/support/office-navigation-app.tsx')],
  outdir: output,
  target: 'browser',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  plugins: [
    {
      name: 'navigation-boundaries',
      setup(build) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: 'pathname',
          namespace: 'navigation-fixture',
        }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: 'link',
          namespace: 'navigation-fixture',
        }));
        build.onResolve(
          {
            filter:
              /@app\/web\/components\/(account-menu|language-switcher|theme-switcher|navigation-progress)$/,
          },
          () => ({ path: 'controls', namespace: 'navigation-fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'navigation-fixture' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === 'pathname'
              ? `import {useSyncExternalStore} from ${reactImport}; const subscribe = (notify) => {window.addEventListener('popstate', notify);return () => window.removeEventListener('popstate', notify)}; export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname);`
              : path === 'link'
                ? `import {createElement} from ${reactImport}; export default function Link({href,onClick,children,...props}) {return createElement('a',{...props,href,onClick:(event) => {onClick?.(event);if(!event.defaultPrevented){if(href.includes('#'))return;event.preventDefault();history.pushState({},'',href);window.dispatchEvent(new PopStateEvent('popstate'));}}},children)}`
                : `import {createElement} from ${reactImport}; export const AccountMenu = ({labels}) => createElement('button',{type:'button'},labels.account); export const LanguageSwitcher = () => null; export const ThemeSwitcher = () => null; export const NavigationProgress = () => null;`,
        }));
      },
    },
  ],
});
if (!result.success) throw new AggregateError(result.logs, 'Navigation fixture build failed');
