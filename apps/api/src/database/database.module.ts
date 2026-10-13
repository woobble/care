import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadApiConfig } from '@care/config';
import { createDatabase, createUnitOfWork } from '@care/database';
import { createLogger } from '@care/logging';
import { databaseSchema } from './schema';
import { API_CONFIG, DATABASE, UNIT_OF_WORK } from '@app/api/tokens';

export type AppDatabase = ReturnType<typeof createDatabase<typeof databaseSchema>>;

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: AppDatabase) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}

@Global()
@Module({
  providers: [
    { provide: API_CONFIG, useFactory: () => loadApiConfig() },
    {
      provide: DATABASE,
      inject: [API_CONFIG],
      useFactory: (config: ReturnType<typeof loadApiConfig>): AppDatabase => {
        if (config.NODE_ENV === 'development') {
          const logger = createLogger('care-database');
          return createDatabase(config.DATABASE_URL, databaseSchema, {
            slowQueryThresholdMs: 250,
            onSlowQuery: (event) => logger.warn(event, 'slow database query'),
          });
        }
        return createDatabase(config.DATABASE_URL, databaseSchema);
      },
    },
    {
      provide: UNIT_OF_WORK,
      inject: [DATABASE],
      useFactory: (database: AppDatabase) => createUnitOfWork(database.db),
    },
    DatabaseLifecycle,
  ],
  exports: [API_CONFIG, DATABASE, UNIT_OF_WORK],
})
export class DatabaseModule {}
