import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { loadApiConfig } from '@care/config';
import { OsrmRouteProvider } from '@care/scheduling';
import type { AppDatabase } from '../../database/database.module';
import { DATABASE } from '../../tokens';

type ApiConfig = ReturnType<typeof loadApiConfig>;
type RoutingHealthStatus = 'not_configured' | 'unverified' | 'ready' | 'unavailable';

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
  const result = await new OsrmRouteProvider(config.ROUTING_OSRM_URL).estimate([
    { visitId: 'health-from', location: from },
    { visitId: 'health-to', location: to },
  ]);
  return result.status === 'available' ? 'ready' : 'unavailable';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly apiConfig = loadApiConfig();

  constructor(@Inject(DATABASE) private readonly database: AppDatabase) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok'] },
        dependencies: {
          type: 'object',
          properties: {
            database: { type: 'string', enum: ['ready'] },
            routing: {
              type: 'string',
              enum: ['not_configured', 'unverified', 'ready', 'unavailable'],
            },
          },
          required: ['database', 'routing'],
        },
      },
      required: ['status', 'dependencies'],
    },
  })
  async health(): Promise<{
    status: 'ok';
    dependencies: { database: 'ready'; routing: RoutingHealthStatus };
  }> {
    await this.database.db.execute(sql`select 1`);
    return {
      status: 'ok',
      dependencies: {
        database: 'ready',
        routing: await routingHealthStatus(this.apiConfig),
      },
    };
  }
}
