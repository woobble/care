// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading API configuration
import '@care/config/load-env';
// oxlint-disable-next-line import/no-unassigned-import -- required by NestJS decorator metadata
import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://care_app:build-only@127.0.0.1:5432/care';
process.env.OIDC_ISSUER ??= 'http://localhost:9000/application/o/care-platform/';
process.env.OIDC_CLIENT_ID ??= 'care-platform';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
const config = new DocumentBuilder()
  .setTitle('Care Platform API')
  .setDescription('Versioned API for the care platform foundation')
  .setVersion('1.0.0')
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, config);
await writeFile(
  new URL('../openapi.json', import.meta.url),
  `${JSON.stringify(document, null, 2)}\n`,
);
await app.close();
