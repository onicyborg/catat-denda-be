import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { MasterRepository, type Actor } from './repository.js';
import {
  MasterStatus,
  ViolationCreateDto,
  ViolationUpdateDto,
  ViolationQuery,
} from './dto.js';
import { PageResult } from '../pagination.js';
const snapshot = (record: {
  code: string;
  name: string;
  category: string;
  defaultAmountPerPerson: number;
  description: string | null;
  isActive: boolean;
}) => ({
  code: record.code,
  name: record.name,
  category: record.category,
  defaultAmountPerPerson: record.defaultAmountPerPerson,
  description: record.description,
  isActive: record.isActive,
});
@Injectable()
export class ViolationsService {
  constructor(private repo: MasterRepository) {}
  async list(query: ViolationQuery) {
    const { page, limit, q, status, category } = query;
    const where: Prisma.ViolationTypeWhereInput = {
      ...(status !== MasterStatus.ALL
        ? { isActive: status === MasterStatus.ACTIVE }
        : {}),
      ...(category ? { category } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.repo.db.$transaction(
      [
        this.repo.db.violationType.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.repo.db.violationType.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new PageResult(data, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }
  async get(id: string) {
    const record = await this.repo.db.violationType.findUnique({
      where: { id },
    });
    if (!record)
      throw new NotFoundException('Jenis kesalahan tidak ditemukan.');
    return record;
  }
  create(body: ViolationCreateDto, actor: Actor) {
    return this.repo.write(async (tx) => {
      const record = await tx.violationType.create({ data: body });
      await this.repo.audit(
        tx,
        actor,
        'VIOLATION_TYPE_CREATE',
        'ViolationType',
        record.id,
        undefined,
        snapshot(record),
      );
      return record;
    });
  }
  update(id: string, body: ViolationUpdateDto, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        const before = await tx.violationType.findUnique({ where: { id } });
        if (!before)
          throw new NotFoundException('Jenis kesalahan tidak ditemukan.');
        const record = await tx.violationType.update({
          where: { id },
          data: body,
        });
        await this.repo.audit(
          tx,
          actor,
          'VIOLATION_TYPE_UPDATE',
          'ViolationType',
          id,
          snapshot(before),
          snapshot(record),
        );
        return record;
      },
      { violationId: id },
    );
  }
  setActive(id: string, isActive: boolean, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        const before = await tx.violationType.findUnique({ where: { id } });
        if (!before)
          throw new NotFoundException('Jenis kesalahan tidak ditemukan.');
        if (before.isActive === isActive) return before;
        const record = await tx.violationType.update({
          where: { id },
          data: { isActive },
        });
        await this.repo.audit(
          tx,
          actor,
          isActive ? 'VIOLATION_TYPE_RESTORE' : 'VIOLATION_TYPE_ARCHIVE',
          'ViolationType',
          id,
          snapshot(before),
          snapshot(record),
        );
        return record;
      },
      { violationId: id },
    );
  }
}
