import { Module } from '@nestjs/common';
import { DrizzleOutboxRepository } from '@care/platform';
import { DATABASE, OUTBOX_WRITER } from '@app/api/tokens';
import { DatabaseModule } from '@app/api/database/database.module';
import type { AppDatabase } from '@app/api/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: OUTBOX_WRITER,
      inject: [DATABASE],
      useFactory: (database: AppDatabase) => new DrizzleOutboxRepository(database.db),
    },
  ],
  exports: [OUTBOX_WRITER],
})
export class PlatformModule {}
