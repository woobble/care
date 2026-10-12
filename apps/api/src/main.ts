// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading API configuration
import '@care/config/load-env';
// oxlint-disable-next-line import/no-unassigned-import -- required by NestJS decorator metadata
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { loadApiConfig } from '@care/config';
import { createLogger } from '@care/logging';
import { startMetricsServer, startTelemetry, stopMetricsServer } from '@care/observability';
import { AppModule } from './app.module';
import { configureApiHttp, createApiFastifyAdapter } from './http/fastify';
import { apiMetrics } from './operational-metrics';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger('care-api');
  const stopTelemetry = await startTelemetry('care-api', config.OTEL_EXPORTER_OTLP_ENDPOINT);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createApiFastifyAdapter(config.TRUSTED_PROXY_HOPS),
    { logger: false },
  );
  app.useLogger(false);
  await configureApiHttp(app, config.WEB_ORIGIN, logger);
  const documentConfig = new DocumentBuilder()
    .setTitle('Care Platform API')
    .setDescription('Versioned API for the care platform foundation')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);
  if (config.NODE_ENV !== 'production') SwaggerModule.setup('docs', app, document);

  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ port: config.PORT }, 'API started');
  const metricsServer = await startMetricsServer(apiMetrics.registry, config.API_METRICS_PORT);
  logger.info({ port: config.API_METRICS_PORT }, 'Internal metrics endpoint started');

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      await stopMetricsServer(metricsServer);
      await stopTelemetry();
    }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
