import { resolve } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Expected temporary output directory');
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, '../e2e/support/form-action-app.tsx')],
  outdir: output,
  target: 'browser',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  plugins: [
    {
      name: 'test-router',
      setup(build) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: 'router',
          namespace: 'test-router',
        }));
        build.onLoad({ filter: /.*/, namespace: 'test-router' }, () => ({
          contents:
            'export const useRouter = () => ({refresh: () => window.formHarness.refreshes++});',
          loader: 'js',
        }));
      },
    },
  ],
});
if (!result.success) throw new AggregateError(result.logs, 'Form fixture build failed');
