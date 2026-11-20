# Backend Catat Denda

NestJS REST `/api/v1`, Prisma 7, PostgreSQL. Node24, pnpm10. Instalasi mandiri dari frontend.

```bash
pnpm install
cp .env.example .env
# Ganti SESSION_SECRET dengan random secret >=32 karakter, misalnya openssl rand -hex 32.
pnpm db:up
pnpm prisma:generate
pnpm prisma:deploy
pnpm dev
```

API lokal `http://127.0.0.1:3001`; browser memakai proxy same-origin frontend. APP_BASE_URL harus origin frontend yang benar. Tidak ada CORS wildcard atau trusted forwarded IP. API mendengarkan loopback; deployment container perlu penyesuaian bind/network dan reverse proxy tepercaya pada fase operasional.

Bootstrap admin dengan `ADMIN_BOOTSTRAP_EMAIL` dan `ADMIN_BOOTSTRAP_PASSWORD` dari environment sementara/secret manager, lalu `pnpm admin:bootstrap`. Password minimal12 karakter, Argon2id. Admin yang sudah ada tidak ditimpa. Hapus environment provisioning sesudahnya. Tidak ada akun/password default, public signup, atau seed karyawan/sample.

`SESSION_SECRET` harus acak dan terpisah antar lingkungan. Rotasi secret mengganti token CSRF; sesi berlangsung24jam (SESSION_TTL_HOURS). Token opaque di cookie efms_session HttpOnly, SameSite=Lax, Path=/api/v1, Secure saat NODE_ENV=production. DB menyimpan hash token; logout revoke dan change-password revoke sesi lain. Mutasi wajib Origin sesuai APP_BASE_URL dan X-CSRF-Token dari login/me; login wajib Origin. CSRF token hanya di memori browser. Rate limit login5/menit per IP, global120/menit per IP, in-memory untuk satu instance; multi-instance perlu shared store sebelum scaling.

`health/live` publik, `health/ready` memerlukan sesi admin dan query DB; reverse proxy produksi harus membatasi readiness dari internet. Semua response no-store; log request JSON metadata tanpa body/cookie/token. Audit transaksi auth tidak menyimpan credential. Shell privat tidak berisi data personal sebelum auth/me berhasil; proteksi otoritatif ada di backend.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm openapi:export
```

E2E membuat schema PostgreSQL acak qa_* dalam DB konfigurasi dan menghapus schema itu setelah tes; tidak menghapus schema public. Jalankan dengan user DB pengembangan yang boleh membuat schema, jangan dengan kredensial produksi. E2E menguji migrasi baru, auth, expiry/revoke, cookie, CSRF, rate-limit dan constraint DB. `NODE_ENV=production node scripts/verify-foundation.mjs` setelah build memverifikasi Secure cookie juga.

OpenAPI tersimpan `openapi.json`; untuk frontend salin artifact ini lalu jalankan `pnpm api:generate` di repo FE. Hanya artifact kontrak yang dipertukarkan, bukan import source lintas repo. Snapshot fase dan hash kontrak dicatat pada docs/development-phases di folder induk.

Migration harus versioned; `pnpm prisma:migrate --name <nama>` hanya development, `pnpm prisma:deploy` untuk deployment. Model minimum tersedia; fitur master/case/payment belum diekspos sampai fase masing-masing. Backup/restore dan production deployment dituntaskan Phase6. Kredensial Compose hanya lokal, DB port5433.
