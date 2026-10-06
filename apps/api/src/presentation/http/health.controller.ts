import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../../database/database.module';
import { DATABASE } from '../../tokens';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: AppDatabase) {}

  @Get()
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string' } } } })
  async health(): Promise<{ status: 'ok' }> {
    await this.database.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
