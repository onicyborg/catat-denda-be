import {
  Catch,
  StreamableFile,
  HttpException,
  ValidationPipe,
  UnprocessableEntityException,
  type ArgumentsHost,
  type ExceptionFilter,
  type INestApplication,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { PageResult } from './pagination.js';
import { ConfigService } from '@nestjs/config';
import { map } from 'rxjs';
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const req = host
      .switchToHttp()
      .getRequest<Request & { requestId: string }>();
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const detail =
      error instanceof HttpException ? error.getResponse() : undefined;
    res.status(status).json({
      error: {
        code: `HTTP_${status}`,
        details:
          typeof detail === 'object' &&
          detail &&
          ('fields' in detail || 'retryable' in detail)
            ? {
                fields: 'fields' in detail ? detail.fields : undefined,
                retryable:
                  'retryable' in detail && detail.retryable === true
                    ? true
                    : undefined,
              }
            : undefined,
        message:
          status === 429
            ? 'Terlalu banyak permintaan. Coba lagi sebentar.'
            : status === 500
              ? 'Terjadi gangguan server.'
              : typeof detail === 'object' && detail && 'message' in detail
                ? detail.message
                : 'Permintaan ditolak.',
      },
      requestId: req.requestId,
    });
  }
}
export function configure(app: INestApplication) {
  const express = app.getHttpAdapter().getInstance();
  express.set(
    'trust proxy',
    app.get(ConfigService).get<boolean>('TRUST_PROXY_LOOPBACK')
      ? 'loopback'
      : false,
  );
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.use(
    (
      req: Request & { requestId: string },
      res: Response,
      next: NextFunction,
    ) => {
      req.requestId = uuidv7();
      const started = process.hrtime.bigint();
      res.setHeader('X-Request-Id', req.requestId);
      res.setHeader('Cache-Control', 'no-store');
      res.on('finish', () =>
        console.log(
          JSON.stringify({
            requestId: req.requestId,
            method: req.method,
            route:
              typeof req.route?.path === 'string'
                ? req.route.path
                : 'unmatched',
            status: res.statusCode,
            durationMs:
              Math.round(
                (Number(process.hrtime.bigint() - started) / 1e6) * 100,
              ) / 100,
            timestamp: new Date().toISOString(),
          }),
        ),
      );
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({
          message: 'Data tidak valid. Periksa kembali isian.',
          fields: errors.map((error) => error.property),
        }),
    }),
  );
  app.useGlobalFilters(new Errors());
  app.useGlobalInterceptors({
    intercept: (_context, next) =>
      next
        .handle()
        .pipe(
          map((data) =>
            data instanceof PageResult || data instanceof StreamableFile
              ? data
              : { data },
          ),
        ),
  });
}
