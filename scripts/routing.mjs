import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOT = path.join(ROOT, 'data', 'osrm');
const GENERATIONS_ROOT = path.join(DATA_ROOT, 'generations');
const CURRENT_LINK = path.join(DATA_ROOT, 'current');
const LOCK_PATH = path.join(DATA_ROOT, '.routing.lock');
const GEOFABRIK_INDEX_URL = 'https://download.geofabrik.de/index-v1.json';
const DEFAULT_REGION = 'europe/germany/nordrhein-westfalen';
const DEFAULT_PROBE_FROM = '6.958860,50.9413';
const DEFAULT_PROBE_TO = '6.956,50.936';
// Keep this digest in sync with the osrm service in compose.yaml.
const OSRM_IMAGE =
  'ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f';
const STARTUP_TIMEOUT_MS = 5 * 60 * 1000;

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const [command, ...args] = process.argv.slice(2);

async function main() {
  if (args.length > 0) return usage(1);
  const settings = loadSettings();

  switch (command) {
    case 'setup':
      await withLock(() => installDataset(settings));
      return showStatus(settings);
    case 'update':
      await withLock(async () => {
        if (!(await readActiveDataset())) {
          throw new Error('No active dataset. Run `bun run routing:setup` first.');
        }
        return installDataset(settings);
      });
      return showStatus(settings);
    case 'status':
      return showStatus(settings);
    default:
      return usage(command ? 1 : 0);
  }
}

function usage(exitCode) {
  console.log(`Usage:
  bun run routing:setup
  bun run routing:update
  bun run routing:status

Set OSRM_REGION in .env to choose a Geofabrik extract.`);
  process.exitCode = exitCode;
}

function loadSettings() {
  const region = parseRegion(process.env.OSRM_REGION || DEFAULT_REGION);
  const probe = {
    from: parseCoordinate(process.env.ROUTING_OSRM_PROBE_FROM || DEFAULT_PROBE_FROM),
    to: parseCoordinate(process.env.ROUTING_OSRM_PROBE_TO || DEFAULT_PROBE_TO),
  };
  const port = Number(process.env.ROUTING_OSRM_PORT || '5000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ROUTING_OSRM_PORT must be an integer from 1 to 65535.');
  }
  return { region, probe, port };
}

function parseRegion(value) {
  const segments = value.split('/');
  if (segments.length === 0 || segments.some((segment) => !/^[a-z0-9][a-z0-9_-]*$/.test(segment))) {
    throw new Error(
      'OSRM_REGION must be a Geofabrik region path, such as europe/germany/nordrhein-westfalen.',
    );
  }
  return value;
}

function datasetName(region) {
  return region.replaceAll('/', '__');
}

function parseCoordinate(value) {
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) {
    throw new Error(`Invalid route probe "${value}"; use longitude,latitude.`);
  }
  const [longitude, latitude] = parts.map(Number);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error(`Route probe "${value}" is outside the WGS84 longitude/latitude range.`);
  }
  return [longitude, latitude];
}

async function withLock(action) {
  await mkdir(DATA_ROOT, { recursive: true });
  const release = await acquireLock();
  try {
    return await action();
  } finally {
    await release();
  }
}

async function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let file;
    try {
      file = await open(LOCK_PATH, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const contents = await readFile(LOCK_PATH, 'utf8').catch(() => '');
      const ownerPid = Number(contents.trim());
      if (!Number.isInteger(ownerPid) || ownerPid < 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      try {
        process.kill(ownerPid, 0);
        throw new Error(`Another routing command is running (PID ${ownerPid}).`, { cause: error });
      } catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError;
      }
      await rm(LOCK_PATH, { force: true });
      continue;
    }
    try {
      await file.writeFile(`${process.pid}\n`);
      return async () => {
        await file.close();
        await rm(LOCK_PATH, { force: true });
      };
    } catch (error) {
      await file.close();
      await rm(LOCK_PATH, { force: true });
      throw error;
    }
  }
  throw new Error('Could not acquire the routing data lock.');
}

async function installDataset(settings) {
  await mkdir(GENERATIONS_ROOT, { recursive: true });
  const previous = await readActiveDataset();
  const region = await getGeofabrikRegion(settings.region);
  const name = datasetName(settings.region);
  const stagingDirectory = await mkdtemp(path.join(DATA_ROOT, '.staging-'));
  let generationDirectory;
  let currentChanged = false;

  try {
    const pbfName = `${name}.osm.pbf`;
    const pbfPath = path.join(stagingDirectory, pbfName);
    console.log(`Downloading ${settings.region} from Geofabrik: ${region.pbfUrl}`);
    await run('curl', [
      '--fail',
      '--location',
      '--retry',
      '3',
      '--retry-delay',
      '2',
      '--output',
      pbfPath,
      region.pbfUrl,
    ]);
    const download = await stat(pbfPath);
    if (!download.isFile() || download.size === 0) {
      throw new Error('Geofabrik returned an empty PBF extract.');
    }
    const downloadedAt = new Date().toISOString();

    console.log(`Preparing ${pbfName} with ${OSRM_IMAGE}`);
    await runOsrm(stagingDirectory, 'osrm-extract', '-p', '/opt/car.lua', `/data/${pbfName}`);
    await runOsrm(stagingDirectory, 'osrm-partition', `/data/${name}.osrm`);
    await runOsrm(stagingDirectory, 'osrm-customize', `/data/${name}.osrm`);
    await assertPreparedDataset(stagingDirectory, name);
    await rm(pbfPath, { force: true });

    const metadata = {
      version: 1,
      region: settings.region,
      datasetName: name,
      pbfUrl: region.pbfUrl,
      osrmImage: OSRM_IMAGE,
      downloadedAt,
      preparedAt: new Date().toISOString(),
      probe: settings.probe,
    };
    await writeFile(
      path.join(stagingDirectory, 'metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    await writeFile(path.join(stagingDirectory, 'dataset-name'), `${name}\n`);
    await writeFile(
      path.join(stagingDirectory, 'route-probe'),
      `${formatCoordinate(settings.probe.from)};${formatCoordinate(settings.probe.to)}\n`,
    );

    const generationName = `generation-${randomUUID()}`;
    generationDirectory = path.join(GENERATIONS_ROOT, generationName);
    await rename(stagingDirectory, generationDirectory);
    await switchCurrent(`generations/${generationName}`);
    currentChanged = true;

    console.log('Starting OSRM and waiting for its route health check.');
    try {
      await compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '300', 'osrm');
      await waitForRoute(metadata, settings.port);
    } catch (error) {
      await rollback(previous, generationDirectory, settings.port);
      currentChanged = false;
      generationDirectory = undefined;
      throw new Error(`The new dataset was not ready and has been rolled back: ${error.message}`, {
        cause: error,
      });
    }

    try {
      await removeOldGenerations(generationDirectory);
    } catch (error) {
      console.warn(`OSRM is ready, but old dataset cleanup failed: ${error.message}`);
    }
  } finally {
    if (!currentChanged && generationDirectory) {
      await rm(generationDirectory, { recursive: true, force: true });
    }
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

function formatCoordinate([longitude, latitude]) {
  return `${longitude},${latitude}`;
}

async function getGeofabrikRegion(regionPath) {
  const response = await fetch(GEOFABRIK_INDEX_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Geofabrik index request failed with HTTP ${response.status}.`);
  const index = await response.json();
  const feature = index.features?.find(
    (entry) => pbfRegionPath(entry.properties?.urls?.pbf) === regionPath,
  );
  if (!feature) {
    throw new Error(`Unknown Geofabrik region "${regionPath}" in index-v1.json.`);
  }
  return {
    name: feature.properties.name ?? regionPath,
    pbfUrl: feature.properties.urls.pbf,
  };
}

function pbfRegionPath(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'download.geofabrik.de') return null;
    const match = url.pathname.match(/^\/(.+)-latest\.osm\.pbf$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function runOsrm(datasetDirectory, ...args) {
  await run('docker', [
    'run',
    '--rm',
    '--volume',
    `${datasetDirectory}:/data`,
    OSRM_IMAGE,
    ...args,
  ]);
}

async function assertPreparedDataset(directory, name) {
  for (const suffix of [
    '.osrm.partition',
    '.osrm.cells',
    '.osrm.mldgr',
    '.osrm.cell_metrics',
    '.osrm.properties',
  ]) {
    const filename = path.join(directory, `${name}${suffix}`);
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new Error(`OSRM preprocessing did not create ${path.basename(filename)}.`);
    }
  }
}

async function readCurrentTarget() {
  let target;
  try {
    target = await readlink(CURRENT_LINK);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read active dataset link: ${error.message}`, { cause: error });
  }
  if (!/^generations\/generation-[a-f0-9-]{36}$/.test(target)) {
    throw new Error('The active dataset link points outside managed generations.');
  }
  return target;
}

async function readActiveDataset() {
  const target = await readCurrentTarget();
  if (!target) return null;
  const directory = path.join(DATA_ROOT, target);
  const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
  if (
    metadata.version !== 1 ||
    parseRegion(metadata.region) !== metadata.region ||
    metadata.datasetName !== datasetName(metadata.region) ||
    !isCoordinatePair(metadata.probe?.from) ||
    !isCoordinatePair(metadata.probe?.to) ||
    !Number.isFinite(Date.parse(metadata.preparedAt))
  ) {
    throw new Error('The active OSRM dataset metadata is invalid.');
  }
  return { target, directory, metadata };
}

function isCoordinatePair(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

async function switchCurrent(target) {
  if (!/^generations\/generation-[a-f0-9-]{36}$/.test(target)) {
    throw new Error('Refusing to switch to a path outside managed generations.');
  }
  const temporaryLink = path.join(DATA_ROOT, `.current-${randomUUID()}`);
  try {
    await symlink(target, temporaryLink, 'dir');
    await rename(temporaryLink, CURRENT_LINK);
  } finally {
    await unlink(temporaryLink).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function rollback(previous, newGenerationDirectory, port) {
  const errors = [];
  try {
    if (previous) {
      await switchCurrent(previous.target);
      await startOsrm();
      await waitForRoute(previous.metadata, port);
    } else {
      await compose('stop', 'osrm');
      await unlink(CURRENT_LINK).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  } catch (error) {
    errors.push(error.message);
  }

  const activeTarget = await readCurrentTarget().catch(() => null);
  const failedTarget = `generations/${path.basename(newGenerationDirectory)}`;
  if (activeTarget !== failedTarget) {
    await rm(newGenerationDirectory, { recursive: true, force: true });
  }
  if (errors.length > 0) {
    throw new Error(`Rollback could not restore a ready service: ${errors.join('; ')}`);
  }
}

async function startOsrm() {
  await compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '300', 'osrm');
}

async function removeOldGenerations(activeDirectory) {
  const activeName = path.basename(activeDirectory);
  for (const entry of await readdir(GENERATIONS_ROOT, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      /^generation-[a-f0-9-]{36}$/.test(entry.name) &&
      entry.name !== activeName
    ) {
      await rm(path.join(GENERATIONS_ROOT, entry.name), { recursive: true, force: true });
    }
  }
}

async function showStatus(settings) {
  console.log(
    `Application routing: ${process.env.ROUTING_OSRM_URL ? 'enabled' : 'not_configured'}`,
  );
  console.log(`Configured region: ${settings.region}`);
  console.log(`Preparation: ${await preparationStatus()}`);

  let active;
  try {
    active = await readActiveDataset();
    if (!active) {
      console.log('Dataset: data_missing');
      console.log('Endpoint: not checked');
      process.exitCode = 1;
      return;
    }
    await assertPreparedDataset(active.directory, active.metadata.datasetName);
  } catch (error) {
    console.log(`Dataset: unavailable (${error.message})`);
    console.log('Endpoint: not checked');
    process.exitCode = 1;
    return;
  }

  console.log(`Dataset: ready (${active.metadata.region})`);
  console.log(`Downloaded: ${active.metadata.downloadedAt}`);
  console.log(`Prepared: ${active.metadata.preparedAt}`);
  const regionMatches = active.metadata.region === settings.region;
  console.log(`Configured region matches dataset: ${regionMatches ? 'yes' : 'no'}`);
  const result = await checkRoute(active.metadata, settings.port);
  console.log(
    result.ready
      ? `Endpoint: ready (http://127.0.0.1:${settings.port})`
      : `Endpoint: unavailable (${result.message})`,
  );
  if (!result.ready || !regionMatches) process.exitCode = 1;
}

async function preparationStatus() {
  let ownerPid;
  try {
    ownerPid = Number((await readFile(LOCK_PATH, 'utf8')).trim());
  } catch (error) {
    if (error.code === 'ENOENT') return 'idle';
    return 'unknown';
  }
  if (!Number.isInteger(ownerPid) || ownerPid < 1) return 'unknown';
  try {
    process.kill(ownerPid, 0);
    return 'preparing';
  } catch (error) {
    return error.code === 'ESRCH' ? 'idle (stale lock)' : 'unknown';
  }
}

async function checkRoute(metadata, port) {
  const { from, to } = metadata.probe;
  const route = `${formatCoordinate(from)};${formatCoordinate(to)}`;
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/route/v1/driving/${route}?overview=false`,
      { signal: AbortSignal.timeout(5_000) },
    );
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.code === 'Ok') return { ready: true };
    const message = `HTTP ${response.status}${body.code ? ` (${body.code})` : ''}`;
    return { ready: false, retry: response.status >= 500 || response.status === 429, message };
  } catch (error) {
    return { ready: false, retry: true, message: error.message };
  }
}

async function waitForRoute(metadata, port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await checkRoute(metadata, port);
    if (lastResult.ready) return;
    if (!lastResult.retry) {
      throw new Error(`The route probe failed (${lastResult.message}); check its coordinates.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for OSRM (${lastResult?.message ?? 'no response'}).`);
}

async function compose(...args) {
  await run('docker', ['compose', '--profile', 'routing', ...args]);
}

function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, { cwd: ROOT, stdio: 'inherit' });
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(name === 'docker' ? 'Docker CLI is unavailable.' : `${name} is unavailable.`),
        );
      } else {
        reject(error);
      }
    });
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited ${signal ? `after ${signal}` : `with code ${code}`}.`));
    });
  });
}

main().catch((error) => {
  const detail =
    error.code === 'ENOSPC' ? `Insufficient disk space: ${error.message}` : error.message;
  console.error(`Routing: ${detail}`);
  process.exitCode = 1;
});
