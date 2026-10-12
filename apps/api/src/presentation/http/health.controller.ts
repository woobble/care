import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { desc, gte, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { loadApiConfig } from '@care/config';
import type { ObjectStorage } from '@care/storage';
import { OsrmRouteProvider } from '@care/scheduling';
import { workerHealth } from '@care/platform';
import { apiMetrics } from '@app/api/operational-metrics';
import type { AppDatabase } from '@app/api/database/database.module';
import { DATABASE, OBJECT_STORAGE } from '@app/api/tokens';

type ApiConfig = ReturnType<typeof loadApiConfig>;
type RoutingHealthStatus = 'not_configured' | 'unverified' | 'ready' | 'unavailable';
type DependencyStatus = 'ready' | 'degraded' | 'unavailable';

const workerStaleAfterMs = 90_000;

export async function routingHealthStatus(
  config: Pick<ApiConfig, 'ROUTING_OSRM_URL' | 'ROUTING_OSRM_PROBE_FROM' | 'ROUTING_OSRM_PROBE_TO'>,
): Promise<RoutingHealthStatus> {
  if (!config.ROUTING_OSRM_URL) return 'not_configured';
  if (!config.ROUTING_OSRM_PROBE_FROM || !config.ROUTING_OSRM_PROBE_TO) return 'unverified';

  const location = (value: string) => {
    const [longitudePart, latitudePart] = value.split(',');
    if (!longitudePart?.trim() || !latitudePart?.trim()) return null;
    const longitude = Number(longitudePart);
    const latitude = Number(latitudePart);
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return null;
    }
    return { longitude, latitude };
  };
  const from = location(config.ROUTING_OSRM_PROBE_FROM);
  const to = location(config.ROUTING_OSRM_PROBE_TO);
  if (!from || !to) return 'unavailable';
  try {
    const result = await new OsrmRouteProvider(config.ROUTING_OSRM_URL).estimate([
      { visitId: 'health-from', location: from },
      { visitId: 'health-to', location: to },
    ]);
    return result.status === 'available' ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly apiConfig = loadApiConfig();

  constructor(
    @Inject(DATABASE) private readonly database: AppDatabase,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get('live')
  @ApiOkResponse({
    schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } },
  })
  liveness(@Res({ passthrough: true }) reply: FastifyReply): { status: 'ok' } {
    reply.header('Cache-Control', 'private, no-store');
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string' } } } })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  async readiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<{
    status: 'ok' | 'unavailable';
    dependencies: {
      database: 'ready' | 'unavailable';
      storage: 'ready' | 'unavailable';
      worker: DependencyStatus;
      routing: RoutingHealthStatus;
    };
  }> {
    reply.header('Cache-Control', 'private, no-store');
    const [databaseStatus, storageStatus, routing] = await Promise.all([
      this.database.db
        .execute(sql`select 1`)
        .then(() => 'ready' as const)
        .catch(() => 'unavailable' as const),
      this.storage
        .check()
        .then(() => 'ready' as const)
        .catch(() => 'unavailable' as const),
      routingHealthStatus(this.apiConfig),
    ]);

    let worker: DependencyStatus = 'unavailable';
    if (databaseStatus === 'ready') {
      try {
        const recentWorkers = await this.database.db
          .select({ schedulerStatus: workerHealth.schedulerStatus })
          .from(workerHealth)
          .where(gte(workerHealth.heartbeatAt, new Date(Date.now() - workerStaleAfterMs)))
          .orderBy(desc(workerHealth.heartbeatAt))
          .limit(20);
        if (recentWorkers.length > 0) {
          worker = recentWorkers.some(({ schedulerStatus }) => schedulerStatus === 'degraded')
            ? 'degraded'
            : recentWorkers.some(({ schedulerStatus }) => schedulerStatus === 'running')
              ? 'ready'
              : 'unavailable';
        }
      } catch {
        worker = 'unavailable';
      }
    }

    const ready = databaseStatus === 'ready' && storageStatus === 'ready';
    apiMetrics.recordReadiness({
      status: ready ? 'ready' : 'unavailable',
      dependencies: {
        database: databaseStatus,
        storage: storageStatus,
        worker,
        routing,
      },
    });
    reply.status(ready ? 200 : 503);
    return {
      status: ready ? 'ok' : 'unavailable',
      dependencies: {
        database: databaseStatus,
        storage: storageStatus,
        worker,
        routing,
      },
    };
  }

  @Get()
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string' } } } })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  health(@Res({ passthrough: true }) reply: FastifyReply) {
    return this.readiness(reply);
  }
}
