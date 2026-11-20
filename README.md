# Backend Catat Denda

NestJS, Prisma 7, dan PostgreSQL. Proyek ini mandiri dari frontend, termasuk dependency dan lockfile pnpm.

## Menjalankan lokal

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm prisma:generate
pnpm dev
```

API berjalan di `http://localhost:3001/api`, dengan health check di `http://localhost:3001/api/health`. PostgreSQL di `127.0.0.1:5433` agar tidak berbenturan dengan layanan lokal pada port 5432.

Schema Prisma ada di `prisma/schema.prisma`. Model akan dibuat setelah brief domain ditentukan. Setelah menambah model, jalankan `pnpm prisma:migrate --name <nama_migrasi>` lalu `pnpm prisma:generate`.

Pemeriksaan: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, dan `pnpm build`. Hentikan database dengan `pnpm db:down`.

Kredensial dalam `compose.yaml` hanya untuk pengembangan lokal. Gunakan nilai berbeda saat deployment.
