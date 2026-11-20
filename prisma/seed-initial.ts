import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { initialEmployees, initialIncidents } from './initial-data.js';

const batch = 'catat-denda:initial-2026:v1';
const normalize = (name: string) =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export const seedKey = (index: number) => `${batch}:incident:${index + 1}`;

export async function seedInitialData(db: PrismaClient, password?: string) {
  return db.$transaction(
    async (tx) => {
      // Serialize reruns, then share the employee namespace lock with the API.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72821, 6)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72821, 1)`;
      let admin = await tx.user.findUnique({ where: { username: 'defyana' } });
      const adminCreated = !admin;
      if (!admin) {
        if (!password || password.length < 10 || password.length > 256)
          throw new Error(
            'Akun baru memerlukan SEED_ADMIN_PASSWORD sepanjang10–256 karakter.',
          );
        admin = await tx.user.create({
          data: {
            username: 'defyana',
            role: 'ADMIN',
            passwordHash: await argon2.hash(password, {
              type: argon2.argon2id,
            }),
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: admin.id,
            action: 'ADMIN_BOOTSTRAP',
            entityType: 'User',
            entityId: admin.id,
          },
        });
      }
      if (!admin.isActive || admin.role !== 'ADMIN')
        throw new Error(
          'Akun defyana harus ADMIN aktif; seeder tidak mengubah akses akun yang sudah ada.',
        );
      const actor = admin.id;
      const audit = (
        entityType: string,
        entityId: string,
        afterJson: Prisma.InputJsonValue,
      ) =>
        tx.auditLog.create({
          data: {
            actorUserId: actor,
            action: 'INITIAL_DATA_SEEDED',
            entityType,
            entityId,
            afterJson,
          },
        });
      if (!(await tx.appSettings.findUnique({ where: { singletonKey: 1 } }))) {
        const settings = await tx.appSettings.create({
          data: { businessName: 'Catat Denda', updatedBy: actor },
        });
        await audit('AppSettings', settings.id, {
          batch,
          businessName: 'Catat Denda',
        });
      }
      const identities = new Map<string, string>();
      const markers = await tx.fineCaseCreation.findMany({
        where: {
          seedKey: {
            in: initialIncidents.map((_, i) => seedKey(i)),
          },
        },
      });
      for (const marker of markers) {
        const index = initialIncidents.findIndex(
          (_, i) => seedKey(i) === marker.seedKey,
        );
        const requestHash = createHash('sha256')
          .update(JSON.stringify({ batch, incident: initialIncidents[index] }))
          .digest('hex');
        if (marker.requestHash !== requestHash)
          throw new Error(
            'Manifest seed berbeda dari batch yang sudah diterapkan.',
          );
      }
      // A completed batch remains untouched even after employees/cases are edited.
      if (markers.length === initialIncidents.length)
        return {
          adminUsername: 'defyana',
          adminCreated,
          employeesCreated: 0,
          casesCreated: 0,
          casesSkipped: markers.length,
          initialStatus: 'DRAFT',
        };
      let employeesCreated = 0;
      for (const name of initialEmployees) {
        const normalizedName = normalize(name);
        const candidates = await tx.employee.findMany({
          where: { normalizedName },
        });
        const alias = await tx.employeeAlias.findUnique({
          where: { aliasNormalized: normalizedName },
        });
        if (
          candidates.length > 1 ||
          (alias && (!candidates[0] || alias.employeeId !== candidates[0].id))
        )
          throw new Error(
            `Identitas ${name} ambigu atau berbenturan dengan alias; tinjau data sebelum seed.`,
          );
        let employee = candidates[0];
        if (!employee) {
          employee = await tx.employee.create({
            data: {
              displayName: name,
              normalizedName,
            },
          });
          employeesCreated++;
          await audit('Employee', employee.id, { batch, displayName: name });
        }
        identities.set(name, employee.id);
      }
      let casesCreated = 0;
      for (const [index, incident] of initialIncidents.entries()) {
        const key = seedKey(index);
        const requestHash = createHash('sha256')
          .update(JSON.stringify({ batch, incident }))
          .digest('hex');
        const existing = await tx.fineCaseCreation.findUnique({
          where: { seedKey: key },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error(
              'Manifest seed berbeda dari batch yang sudah diterapkan. Buat batch baru dengan review eksplisit.',
            );
          continue;
        }
        const fine = await tx.fineCase.create({
          data: {
            description: incident.description,
            sourceText: incident.sourceText,
            occurredAt: null,
            violationTypeId: null,
            status: 'DRAFT',
            createdBy: actor,
            members: {
              create: incident.employees.map((name) => ({
                employeeId: identities.get(name)!,
                rawEmployeeName: name,
                assignedAmount:
                  incident.total === null
                    ? null
                    : incident.total / incident.employees.length,
              })),
            },
            creation: {
              create: { seedKey: key, actorUserId: actor, requestHash },
            },
          },
        });
        await audit('FineCase', fine.id, {
          batch,
          status: 'DRAFT',
          sourceText: incident.sourceText,
          sourceTotal: incident.total,
          reviewRequired: true,
        });
        casesCreated++;
      }
      return {
        adminUsername: 'defyana',
        adminCreated,
        employeesCreated,
        casesCreated,
        casesSkipped: initialIncidents.length - casesCreated,
        initialStatus: 'DRAFT',
      };
    },
    { timeout: 30000, maxWait: 15000 },
  );
}
