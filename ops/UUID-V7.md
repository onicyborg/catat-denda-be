# UUIDv7 dan inisiasi ulang lokal

20 November2026. Pemilik meminta seluruh ID backend menggunakan UUIDv7 serta reset database dan seed ulang. Target terverifikasi: PostgreSQL development localhost:5433/catat_denda, schema public. Tidak mengubah database deployment/server lain.

## Implementasi

Sebelas model aplikasi kini mempunyai kolom id bertipe UUID dengan `@default(uuid(7))`: User, AuthSession, Employee, EmployeeAlias, ViolationType, FineCase, FineCaseMember, PaymentEntry, AuditLog, AppSettings dan FineCaseCreation. Pembuatan melalui Prisma, termasuk createMany/nested create, menghasilkan UUIDv7 baru. UUID primary key tidak diambil dari nama, nomor kasus atau hash source. FK mengacu ke ID row yang sama.

AppSettings mempunyai ID UUIDv7; pemilihan satu row tetap memakai singletonKey integer1 yang unique dan dilindungi CHECK currency/timezone. singletonKey dan caseNumber adalah selector/nomor bisnis, bukan ID entitas. Audit AppSettings kini menunjuk settings.id sebenarnya, menggantikan UUIDv4 sintetis yang sebelumnya dipakai. Kontrak response settings tetap sama karena ID internal ini tidak dipublikasikan pada endpoint settings.

FineCaseCreation mempunyai ID UUIDv7 tersendiri. `key` adalah unique correlation token Idempotency-Key dari client; header UUID yang sebelumnya diterima tetap kompatibel dan bukan primary key row. Bila key dibuat seeder, default-nya UUIDv7. `seedKey` teks stabil mengidentifikasi batch/incident agar UUIDv7 dapat dibuat baru setiap reset dan seed tetap no-op saat diulang. Manifest/source hash dan transaksi/advisory lock tetap melindungi duplikasi serta perubahan source.

Request ID serta ID entity audit untuk export report dibuat menggunakan uuid.v7 dari paket uuid14.0.3. Token sesi dan CSRF tetap menggunakan mekanisme kriptografi auth yang sudah ada; UUID entitas tidak dijadikan token autentikasi.

Migration006 mengubah PK settings, menambah singletonKey dan PK creation, serta menyesuaikan referensi audit settings. Untuk database berisi data, migration menggunakan helper SQL sementara yang membentuk timestamp48bit Unix millisecond dan entropy74bit sesuai layout UUIDv7 pada PostgreSQL17, lalu helper dihapus. Tidak membutuhkan extension atau upgrade PostgreSQL. Marker seed v5 lama dipetakan ke seedKey teks agar upgrade tanpa reset tidak menggandakan batch.

Migration tidak diam-diam mengganti ID lama User/Employee/case/ledger beserta histori pada database deployment. Reset lokal yang diminta pemilik menghasilkan seluruh data aplikasi baru UUIDv7; kebutuhan mengonversi database lain yang sudah berisi data memerlukan migrasi data tersendiri. Metadata internal Prisma `_prisma_migrations` dikelola Prisma, bukan ID entitas aplikasi, dan tidak dimanipulasi.

## Reset yang dijalankan

`pnpm exec prisma migrate reset --force` diterapkan hanya ke target development yang diperiksa, sesudah pengujian schema disposable lulus. Prisma meminta pencatatan consent; environment consent diisi dengan teks persis permintaan reset pemilik melalui mekanisme resmi CLI. Seluruh enam migration diterapkan kembali, kemudian `pnpm db:seed` dijalankan. Credential hash admin lokal dipertahankan hanya untuk menjaga login defyana; row/User ID dan seluruh data seed dibuat baru. Tidak menyimpan atau mencetak password plaintext.

Hasil DB lokal:1 admin defyana,11 karyawan,18 DRAFT,23 alokasi,20 nominal diketahui dengan total105000,3 nominal null,0 ledger,1 settings. Semua tanggal dan jenis kejadian tetap menunggu review. Pemeriksaan29 kolom UUID atas284 nilai non-null di seluruh tabel aplikasi: seluruhnya UUIDv7, termasuk FK serta entityId audit. Seed kedua casesCreated0/casesSkipped18, tidak menggandakan data. Sesi lama hilang ketika reset; pengguna perlu login ulang.

## Pengujian

- `pnpm prisma:generate`, typecheck, lint, build dan13 unit test: PASS.
- Enam runner `pnpm test:e2e`: PASS foundation/auth/master/fines/payments/reporting, termasuk konflik uang, rollback audit, settings dan CSV.
- `pnpm test:seed`: PASS18 draft/11 karyawan/23 alokasi/105000, concurrency/replay, preservasi edit/password, manifest mismatch dan alias conflict. Smoke mengakses/edit UUIDv7 melalui API, membuat jenis/alias, posting satu draft QA, payment/reversal dan export. Seluruh11 tabel harus terisi pada schema QA lalu setiap ID diperiksa versi7; entityId/requestId audit dan ID settings juga diperiksa.
- `node scripts/verify-uuid-migration.mjs`: PASS upgrade schema berisi data lama, mempertahankan businessName, relasi case/creation, key idempotensi, seedKey dan audit settings; helper SQL dihapus setelah backfill.
- Audit dependency produksi:0 advisory. Hash OpenAPI BE/FE tetap cocok.
- Regresi browser frontend:29/29 PASS (57.5detik) menggunakan backend baru dengan IDv7, mencakup login, master, case, ledger, CSV, audit, settings dan grafik. Tidak ada perubahan source/kontrak frontend.

Jalankan `pnpm test:uuid` untuk mengulang seed/UUID dan legacy migration smoke pada schema acak. Runner tidak mereset schema operasional. Perintah reset destruktif bukan bagian startup, migrate deploy atau seed; hanya dilakukan pada target lokal atas permintaan eksplisit ini.

Referensi implementasi: [Prisma7 uuid defaults](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference), [uuid v7](https://github.com/uuidjs/uuid#uuidv7options-buffer-offset), [RFC9562](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7).
