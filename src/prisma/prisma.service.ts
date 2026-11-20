import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg(
        {
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        },
        {
          schema:
            new URL(config.getOrThrow<string>('DATABASE_URL')).searchParams.get(
              'schema',
            ) ?? 'public',
        },
      ),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
