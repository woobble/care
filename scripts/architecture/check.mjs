import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { parseSync } from 'oxc-parser';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sort = (items) =>
  [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
export function analyze(root, policy) {
  root = resolve(root);
  const files = new Map();
  const workspaces = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.next', 'test-results', '.turbo'].includes(entry.name))
        continue;
      const path = join(dir, entry.name);
      if (relative(root, path) === 'packages/api-client/src/generated') continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?tsx?$/.test(path) && !path.endsWith('.d.ts'))
        files.set(relative(root, path), null);
    }
  };
  for (const group of ['apps', 'modules', 'packages']) {
    walk(join(root, group));
    if (!existsSync(join(root, group))) continue;
    for (const name of readdirSync(join(root, group))) {
      const manifest = join(root, group, name, 'package.json');
      if (existsSync(manifest))
        workspaces.set(read(manifest).name, { dir: `${group}/${name}`, ...read(manifest) });
    }
  }
  for (const workspace of workspaces.values()) {
    if (!workspace.dir.startsWith('modules/')) continue;
    const name = workspace.dir.split('/')[1];
    if (!policy.modules[name]) throw new Error(`Missing module ownership: ${name}`);
    if (!files.has(policy.modules[name].public))
      throw new Error(`Missing public module entry: ${name}`);
  }
  const owner = (path) => (path?.startsWith('modules/') ? path.split('/')[1] : null);
  const resolveFile = (base) =>
    [
      base,
      base.replace(/\.js$/, '.ts'),
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((p) => files.has(p));
  const configCache = new Map();
  const pathsFor = (file) => {
    let dir = dirname(join(root, file));
    while (dir.startsWith(root)) {
      const path = join(dir, 'tsconfig.json');
      if (existsSync(path)) return loadConfig(path);
      if (dir === root) break;
      dir = dirname(dir);
    }
    return [];
  };
  const loadConfig = (path) => {
    if (configCache.has(path)) return configCache.get(path);
    const value = read(path);
    const inherited = value.extends?.startsWith('.')
      ? loadConfig(resolve(dirname(path), value.extends))
      : [];
    const aliases = value.compilerOptions?.paths;
    const result = aliases
      ? Object.entries(aliases).map(([key, targets]) => [
          key,
          targets.map((target) =>
            relative(root, resolve(dirname(path), value.compilerOptions.baseUrl ?? '.', target)),
          ),
        ])
      : inherited;
    configCache.set(path, result);
    return result;
  };
  const target = (file, specifier) => {
    if (specifier.startsWith('.'))
      return resolveFile(relative(root, resolve(root, dirname(file), specifier)));
    for (const [key, values] of pathsFor(file)) {
      const [prefix, suffix] = key.split('*');
      if (
        suffix === undefined
          ? specifier === key
          : specifier.startsWith(prefix) && specifier.endsWith(suffix)
      ) {
        const middle =
          suffix === undefined
            ? ''
            : specifier.slice(prefix.length, specifier.length - suffix.length);
        for (const value of values) {
          const found = resolveFile(value.replace('*', middle));
          if (found) return found;
        }
      }
    }
    const pkg = [...workspaces.keys()].find(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    );
    if (!pkg) return undefined;
    const workspace = workspaces.get(pkg);
    const subpath = specifier === pkg ? '.' : `.${specifier.slice(pkg.length)}`;
    let exported = workspace.exports?.[subpath];
    if (!exported)
      for (const [key, value] of Object.entries(workspace.exports ?? {})) {
        if (!key.includes('*')) continue;
        const [prefix, suffix] = key.split('*');
        if (subpath.startsWith(prefix) && subpath.endsWith(suffix))
          exported =
            typeof value === 'string'
              ? value.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length))
              : value;
      }
    const entry = typeof exported === 'string' ? exported : (exported?.import ?? exported?.default);
    return (
      resolveFile(
        entry
          ? join(workspace.dir, entry)
          : join(workspace.dir, specifier.slice(pkg.length), 'index.ts'),
      ) ?? resolveFile(join(workspace.dir, specifier.slice(pkg.length)))
    );
  };
  const violations = [];
  const add = (kind, file, symbol, destination, reason, line = 1) =>
    violations.push({ kind, file, symbol, target: destination, reason, line });
  for (const file of files.keys()) {
    const text = readFileSync(join(root, file), 'utf8');
    const parsed = parseSync(file, text);
    if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0].message}`);
    const imports = new Map();
    const exports = new Map();
    const stars = [];
    const refs = [];
    const line = (node) => text.slice(0, node.start).split('\n').length;
    const ref = (source, symbol, node) => {
      const dest = target(file, source);
      if (
        !dest &&
        !/\.(json|css|svg|mjs|cjs)$/.test(source) &&
        !(file === 'packages/api-client/src/index.ts' && source.startsWith('./generated')) &&
        (/^@(care|module|package|app)\//.test(source) || source.startsWith('.'))
      )
        add(
          'unresolved',
          file,
          symbol,
          source,
          'Workspace import cannot be resolved; use an exported entry point.',
          line(node),
        );
      refs.push({ dest, symbol, source, line: line(node) });
      return { file: dest, symbol };
    };
    for (const node of parsed.program.body) {
      if (
        node.type === 'TSImportEqualsDeclaration' &&
        node.moduleReference.type === 'TSExternalModuleReference'
      ) {
        imports.set(node.id.name, ref(node.moduleReference.expression.value, '*', node));
      }
      if (node.type === 'ImportDeclaration') {
        if (!node.specifiers.length) ref(node.source.value, '*', node);
        for (const spec of node.specifiers)
          imports.set(
            spec.local.name,
            ref(
              node.source.value,
              spec.imported?.name ??
                spec.imported?.value ??
                (spec.type === 'ImportNamespaceSpecifier' ? '*' : 'default'),
              node,
            ),
          );
      }
      if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'Identifier')
        exports.set('default', { local: node.declaration.name });
      if (node.type === 'ExportAllDeclaration') {
        const origin = ref(node.source.value, '*', node);
        if (node.exported) exports.set(node.exported.name ?? node.exported.value, origin);
        else stars.push(origin);
      }
      if (node.type === 'ExportNamedDeclaration') {
        for (const spec of node.specifiers)
          exports.set(
            spec.exported.name ?? spec.exported.value,
            node.source
              ? ref(node.source.value, spec.local.name ?? spec.local.value, node)
              : { local: spec.local.name },
          );
        const decl = node.declaration;
        if (decl?.id?.name)
          exports.set(decl.id.name, {
            local: decl.id.name,
            typeOnly: /Interface|TypeAlias/.test(decl.type),
          });
        for (const item of decl?.declarations ?? [])
          if (item.id.type === 'Identifier') exports.set(item.id.name, { local: item.id.name });
      }
    }
    // Literal dynamic imports, require calls, and import types are checked conservatively as namespaces.
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ImportExpression' && typeof node.source?.value === 'string')
        ref(node.source.value, '*', node);
      if (
        node.type === 'CallExpression' &&
        node.callee?.name === 'require' &&
        typeof node.arguments[0]?.value === 'string'
      )
        ref(node.arguments[0].value, '*', node);
      if (node.type === 'TSImportType' && typeof node.source?.value === 'string')
        ref(node.source.value, '*', node);
      for (const [key, value] of Object.entries(node))
        if (key !== 'parent') {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(parsed.program);
    files.set(file, { imports, exports, stars, refs });
  }
  const persistence = (file, symbol, seen = new Set()) => {
    if (!file || seen.has(`${file}:${symbol}`)) return [];
    seen.add(`${file}:${symbol}`);
    const data = files.get(file);
    const definition = data.exports.get(symbol);
    if (
      definition &&
      policy.modules[owner(file)]?.persistence.includes(file) &&
      !definition.typeOnly
    )
      return [{ file, symbol }];
    if (symbol === '*')
      return [...data.exports.keys()]
        .flatMap((name) => persistence(file, name, new Set(seen)))
        .concat(data.stars.flatMap((s) => persistence(s.file, '*', new Set(seen))));
    if (definition?.file) return persistence(definition.file, definition.symbol, seen);
    if (definition?.local && data.imports.has(definition.local)) {
      const origin = data.imports.get(definition.local);
      return persistence(origin.file, origin.symbol, seen);
    }
    if (definition) return [];
    return data.stars.flatMap((s) => persistence(s.file, symbol, new Set(seen)));
  };
  const edges = [];
  for (const [file, data] of files) {
    const from = owner(file);
    if (from && !policy.modules[from]) throw new Error(`Missing module ownership: ${from}`);
    if (
      from &&
      /(?:^|[/-])schema\.ts$/.test(file) &&
      !policy.modules[from].persistence.includes(file)
    )
      throw new Error(`Unmapped persistence schema: ${file}`);
    for (const ref of data.refs) {
      const to = owner(ref.dest);
      if (!ref.dest || (from && from === to)) continue;
      if (from && ref.dest.startsWith('apps/'))
        add(
          'direction',
          file,
          ref.symbol,
          ref.dest,
          'Domain modules must not depend on application composition.',
          ref.line,
        );
      const exception = policy.exceptions.find((e) => e.files.includes(file));
      if (to && ref.dest !== policy.modules[to]?.public && !exception?.allow.includes('private'))
        add(
          'private',
          file,
          ref.symbol,
          ref.dest,
          `Use @care/${to}; this implementation file is private.`,
          ref.line,
        );
      if (to && file.startsWith('packages/') && !exception?.allow.includes('direction'))
        add(
          'direction',
          file,
          ref.symbol,
          ref.dest,
          'Shared infrastructure must not depend on domain modules.',
          ref.line,
        );
      if (to && file.startsWith('apps/web/') && !exception?.allow.includes('direction'))
        add(
          'direction',
          file,
          ref.symbol,
          ref.dest,
          'Web must consume HTTP contracts, not backend domain modules.',
          ref.line,
        );
      if (!exception?.allow.includes('persistence'))
        for (const origin of persistence(ref.dest, ref.symbol)) {
          if (owner(origin.file) !== from)
            add(
              'persistence',
              file,
              ref.symbol,
              `${origin.file}#${origin.symbol}`,
              `Persistence belongs to ${owner(origin.file)}; use its public application/query API.`,
              ref.line,
            );
        }
      if (from && to) edges.push({ from, to, file, ...ref });
    }
  }
  const adjacency = new Map();
  for (const e of edges) adjacency.set(e.from, new Set([...(adjacency.get(e.from) ?? []), e.to]));
  const reaches = (start, end, seen = new Set()) => {
    if (start === end) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return [...(adjacency.get(start) ?? [])].some((next) => reaches(next, end, seen));
  };
  for (const edge of edges)
    if (reaches(edge.to, edge.from))
      add(
        'cycle',
        edge.file,
        edge.symbol,
        edge.dest,
        `${edge.from} → ${edge.to} participates in a module cycle (including type/schema dependencies).`,
        edge.line,
      );
  const unique = new Map(violations.map((v) => [identity(v), v]));
  return {
    violations: sort(unique.values()),
    dependencies: sort(
      [...adjacency].map(([module, deps]) => ({ module, dependencies: [...deps].sort() })),
    ),
  };
}
export function identity({ kind, file, symbol, target }) {
  return JSON.stringify([kind, file, symbol, target]);
}
export function compareBaseline(violations, baseline) {
  const accepted = new Set(baseline.map(identity));
  const current = new Set(violations.map(identity));
  return {
    added: violations.filter((v) => !accepted.has(identity(v))),
    resolved: baseline.filter((v) => !current.has(identity(v))),
  };
}
if (import.meta.main) {
  const root = process.cwd();
  const result = analyze(root, read(join(root, 'scripts/architecture/ownership.json')));
  if (process.argv.includes('--report')) console.log(JSON.stringify(result, null, 2));
  else {
    const { added, resolved } = compareBaseline(
      result.violations,
      read(join(root, 'scripts/architecture/baseline.json')).violations,
    );
    for (const v of added)
      console.error(`${v.file}:${v.line} [${v.kind}] ${v.symbol} → ${v.target}: ${v.reason}`);
    console.log(
      `Architecture: ${result.violations.length} existing violations; ${added.length} new; ${resolved.length} resolved baseline entries (remove explicitly).`,
    );
    process.exitCode = added.length ? 1 : 0;
  }
}
