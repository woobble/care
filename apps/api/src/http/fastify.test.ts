import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, expect, test } from 'bun:test';
import type { ApiRequest } from './request';
import { configureApiHttp, createApiFastifyAdapter } from './fastify';

@Controller()
class FastifyProbeController {
  @Get('context')
  context(@Req() request: ApiRequest) {
    return request.context;
  }

  @Post('empty-json')
  emptyJson(@Body() body: unknown) {
    return body;
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 512 * 1024, files: 1 } }))
  upload(@Body() body: { organizationId?: string }, @UploadedFile() file?: { buffer?: Buffer }) {
    return { organizationId: body.organizationId, fileSize: file?.buffer?.byteLength };
  }
}

@Module({ controllers: [FastifyProbeController] })
class FastifyProbeModule {}

describe('Fastify HTTP adapter', () => {
  test('preserves HTTP headers and bounded multipart uploads', async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      FastifyProbeModule,
      createApiFastifyAdapter(),
      { logger: false },
    );

    try {
      await configureApiHttp(app, 'http://localhost:3000');
      await app.init();

      const contextResponse = await app.inject({
        method: 'GET',
        url: '/context',
        headers: {
          origin: 'http://localhost:3000',
          'x-request-id': 'request-123',
          'x-correlation-id': 'correlation-123',
        },
      });
      expect(contextResponse.statusCode).toBe(200);
      expect(JSON.parse(contextResponse.body)).toEqual({
        requestId: 'request-123',
        correlationId: 'correlation-123',
      });
      expect(contextResponse.headers['x-request-id']).toBe('request-123');
      expect(contextResponse.headers['x-correlation-id']).toBe('correlation-123');
      expect(contextResponse.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(contextResponse.headers['x-content-type-options']).toBe('nosniff');

      const invalidCorrelationResponse = await app.inject({
        method: 'GET',
        url: '/context',
        headers: { 'x-request-id': 'request-456', 'x-correlation-id': 'invalid id' },
      });
      expect(JSON.parse(invalidCorrelationResponse.body)).toEqual({
        requestId: 'request-456',
        correlationId: 'request-456',
      });

      const emptyJsonResponse = await app.inject({
        method: 'POST',
        url: '/empty-json',
        headers: { 'content-type': 'application/json' },
      });
      expect(emptyJsonResponse.statusCode).toBe(201);
      expect(JSON.parse(emptyJsonResponse.body)).toEqual({});

      const validUpload = await multipartRequest({ fileContents: 'logo-bytes' });
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: validUpload.headers,
        payload: validUpload.payload,
      });
      expect(uploadResponse.statusCode).toBe(201);
      expect(JSON.parse(uploadResponse.body)).toEqual({ organizationId: 'org-123', fileSize: 10 });

      const oversizedUpload = await multipartRequest({ fileContents: 'x'.repeat(512 * 1024 + 1) });
      const oversizedResponse = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: oversizedUpload.headers,
        payload: oversizedUpload.payload,
      });
      expect(oversizedResponse.statusCode).toBe(413);

      const multipleFiles = await multipartRequest({ fileContents: 'logo', secondFile: true });
      const multipleFilesResponse = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: multipleFiles.headers,
        payload: multipleFiles.payload,
      });
      expect(multipleFilesResponse.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

async function multipartRequest(input: {
  fileContents: string;
  secondFile?: boolean;
}): Promise<{ headers: { 'content-type': string }; payload: Buffer }> {
  const form = new FormData();
  form.set('organizationId', 'org-123');
  form.append('file', new Blob([input.fileContents], { type: 'image/png' }), 'logo.png');
  if (input.secondFile) {
    form.append('file', new Blob(['second-file'], { type: 'image/png' }), 'second.png');
  }
  const request = new Request('http://localhost/upload', { method: 'POST', body: form });
  return {
    headers: { 'content-type': request.headers.get('content-type')! },
    payload: Buffer.from(await request.arrayBuffer()),
  };
}
