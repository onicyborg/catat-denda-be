import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configure } from './http.js';
const app = await NestFactory.create(AppModule);
configure(app);
await app.listen(
  app.get(ConfigService).getOrThrow<number>('PORT'),
  '127.0.0.1',
);
