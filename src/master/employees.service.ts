import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { MasterRepository, type Actor } from './repository.js';
import {
  EmployeeCreateDto,
  EmployeeUpdateDto,
  MasterQuery,
  MasterStatus,
  normalizeName,
} from './dto.js';
import { PageResult } from '../pagination.js';
const select = {
  id: true,
  displayName: true,
  employeeCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  aliases: {
    select: { id: true, aliasDisplay: true },
    orderBy: { aliasNormalized: 'asc' },
  },
} satisfies Prisma.EmployeeSelect;
type Employee = Prisma.EmployeeGetPayload<{ select: typeof select }>;
const snapshot = (employee: Employee) => ({
  displayName: employee.displayName,
  employeeCode: employee.employeeCode,
  isActive: employee.isActive,
  aliases: employee.aliases,
});
@Injectable()
export class EmployeesService {
  constructor(private repo: MasterRepository) {}
  async list(query: MasterQuery) {
    const { page, limit, q, status } = query;
    const where: Prisma.EmployeeWhereInput = {
      ...(status !== MasterStatus.ALL
        ? { isActive: status === MasterStatus.ACTIVE }
        : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { normalizedName: { contains: normalizeName(q) } },
              { employeeCode: { contains: q, mode: 'insensitive' } },
              {
                aliases: {
                  some: { aliasNormalized: { contains: normalizeName(q) } },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await this.repo.db.$transaction(
      [
        this.repo.db.employee.findMany({
          where,
          select,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.repo.db.employee.count({ where }),
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
    const employee = await this.repo.db.employee.findUnique({
      where: { id },
      select,
    });
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan.');
    return employee;
  }
  create(body: EmployeeCreateDto, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        const normalizedName = normalizeName(body.displayName);
        if (
          await tx.employeeAlias.findUnique({
            where: { aliasNormalized: normalizedName },
          })
        )
          throw new ConflictException(
            'Nama ini sudah menjadi alias karyawan lain. Periksa identitas karyawan.',
          );
        const employee = await tx.employee.create({
          data: {
            displayName: body.displayName,
            employeeCode: body.employeeCode,
            normalizedName,
          },
          select,
        });
        await this.repo.audit(
          tx,
          actor,
          'EMPLOYEE_CREATE',
          'Employee',
          employee.id,
          undefined,
          snapshot(employee),
        );
        return employee;
      },
      { identity: true },
    );
  }
  update(id: string, body: EmployeeUpdateDto, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        const before = await tx.employee.findUnique({ where: { id }, select });
        if (!before) throw new NotFoundException('Karyawan tidak ditemukan.');
        const normalizedName =
          body.displayName !== undefined
            ? normalizeName(body.displayName)
            : undefined;
        if (normalizedName) {
          const alias = await tx.employeeAlias.findUnique({
            where: { aliasNormalized: normalizedName },
          });
          if (alias && alias.employeeId !== id)
            throw new ConflictException(
              'Nama ini sudah menjadi alias karyawan lain. Periksa identitas karyawan.',
            );
        }
        const employee = await tx.employee.update({
          where: { id },
          data: {
            displayName: body.displayName,
            employeeCode: body.employeeCode,
            normalizedName,
          },
          select,
        });
        await this.repo.audit(
          tx,
          actor,
          'EMPLOYEE_UPDATE',
          'Employee',
          id,
          snapshot(before),
          snapshot(employee),
        );
        return employee;
      },
      { identity: true },
    );
  }
  setActive(id: string, isActive: boolean, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        const before = await tx.employee.findUnique({ where: { id }, select });
        if (!before) throw new NotFoundException('Karyawan tidak ditemukan.');
        if (before.isActive === isActive) return before;
        const employee = await tx.employee.update({
          where: { id },
          data: { isActive, archivedAt: isActive ? null : new Date() },
          select,
        });
        await this.repo.audit(
          tx,
          actor,
          isActive ? 'EMPLOYEE_RESTORE' : 'EMPLOYEE_ARCHIVE',
          'Employee',
          id,
          snapshot(before),
          snapshot(employee),
        );
        return employee;
      },
      { identity: true },
    );
  }
  addAlias(id: string, aliasDisplay: string, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        if (!(await tx.employee.findUnique({ where: { id } })))
          throw new NotFoundException('Karyawan tidak ditemukan.');
        const aliasNormalized = normalizeName(aliasDisplay);
        if (
          await tx.employee.findFirst({
            where: { normalizedName: aliasNormalized, id: { not: id } },
          })
        )
          throw new ConflictException(
            'Alias sama dengan nama utama karyawan lain. Tentukan identitas secara eksplisit.',
          );
        const alias = await tx.employeeAlias.create({
          data: { employeeId: id, aliasDisplay, aliasNormalized },
          select: { id: true, aliasDisplay: true },
        });
        await this.repo.audit(
          tx,
          actor,
          'ALIAS_ADD',
          'EmployeeAlias',
          alias.id,
          undefined,
          { employeeId: id, aliasDisplay },
        );
        return alias;
      },
      { identity: true },
    );
  }
  removeAlias(id: string, aliasId: string, actor: Actor) {
    return this.repo.write(
      async (tx) => {
        const alias = await tx.employeeAlias.findFirst({
          where: { id: aliasId, employeeId: id },
        });
        if (!alias)
          throw new NotFoundException('Alias karyawan tidak ditemukan.');
        await tx.employeeAlias.delete({ where: { id: aliasId } });
        await this.repo.audit(
          tx,
          actor,
          'ALIAS_REMOVE',
          'EmployeeAlias',
          aliasId,
          { employeeId: id, aliasDisplay: alias.aliasDisplay },
        );
        return { success: true };
      },
      { identity: true },
    );
  }
}
