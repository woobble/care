import '@care/config/load-env';
import 'reflect-metadata';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { loadApiConfig } from '@care/config';
import { createLogger, createHttpLogger } from '@care/logging';
import { startTelemetry } from '@care/observability';
import { AppModule } from './app.module';
import { RequestContextMiddleware } from './http/request-context.middleware';
import type { ApiRequest } from './http/request';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger('care-api');
  const stopTelemetry = await startTelemetry('care-api', config.OTEL_EXPORTER_OTLP_ENDPOINT);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useLogger(false);
  app.use(createHttpLogger(logger));
  const contextMiddleware = new RequestContextMiddleware();
  app.use((request: Request, response: Response, next: NextFunction) => {
    contextMiddleware.use(request as ApiRequest, response, next);
  });
  app.use(helmet());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Tenant-Id',
      'X-Request-Id',
      'X-Correlation-Id',
    ],
    credentials: false,
  });
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

  const shutdown = async () => {
    await app.close();
    await stopTelemetry();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
