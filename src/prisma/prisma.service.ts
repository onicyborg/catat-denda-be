import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly schema: string;
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
    this.schema =
      new URL(config.getOrThrow<string>('DATABASE_URL')).searchParams.get(
        'schema',
      ) ?? 'public';
  }

  async lockRow(
    tx: Prisma.TransactionClient,
    table:
      'User' | 'ViolationType' | 'Employee' | 'FineCase' | 'FineCaseMember',
    id: string,
  ) {
    const relation = this.relation(table);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM ${relation} WHERE id = ${id}::uuid FOR UPDATE`,
    );
  }

  relation(
    table:
      | 'User'
      | 'ViolationType'
      | 'Employee'
      | 'FineCase'
      | 'FineCaseMember'
      | 'PaymentEntry'
      | 'AuditLog'
      | 'AppSettings',
  ) {
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    return Prisma.raw(`${quote(this.schema)}.${quote(table)}`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
