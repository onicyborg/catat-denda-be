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

Bootstrap admin dengan `ADMIN_BOOTSTRAP_USERNAME` (atau `ADMIN_BOOTSTRAP_EMAIL` untuk akun lama) dan `ADMIN_BOOTSTRAP_PASSWORD` dari environment sementara/secret manager, lalu `pnpm admin:bootstrap`. Password minimal12 karakter, Argon2id. Admin yang sudah ada tidak ditimpa. Hapus environment provisioning sesudahnya. Tidak ada password fallback di source, public signup, atau seed karyawan/sample.

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

Pengujian regresi Phase1 juga mencakup trailing slash/HEAD pada endpoint publik, JSON rusak, CSRF invalid tanpa perubahan sesi, dan pencabutan sesi saat request password sedang menunggu lock DB. Password lama yang salah mengembalikan422; sesi kedaluwarsa/revoked mengembalikan401. Environment menolak URL database non-PostgreSQL, origin dengan path/kredensial, dan placeholder SESSION_SECRET saat production.

Untuk tes browser terintegrasi, jalankan `pnpm test:browser:server` dari backend, kemudian `pnpm test:e2e` dari frontend. Server QA memakai loopback3101 dan schema acak terisolasi, frontend QA port3100. Hentikan server dengan Ctrl+C setelah tes agar schema QA dihapus. Restart server QA sebelum mengulang suite agar akun dan rate-limit kembali baru. Akun di server ini khusus tes dan tidak dibuat pada schema operasional.

Login kini menerima `username` (case-insensitive, trim). Akun dengan email lama tetap dapat masuk dengan email pada field username; payload `email` API lama juga diterima untuk transisi. Kirim tepat satu identifier. Profil auth/me mengembalikan username dan email nullable. Username unik3–40 karakter huruf kecil, angka, titik, underscore atau dash; email opsional dan tidak dibuat-buat untuk akun username-only.

Provisioning username menggunakan `ADMIN_BOOTSTRAP_USERNAME`, password melalui `ADMIN_BOOTSTRAP_PASSWORD`; email dapat ditambahkan opsional. CLI tetap mensyaratkan password minimal12 karakter dan tidak menimpa akun lama. Akun awal yang diminta pemilik telah diprovision secara lokal dengan pengecualian panjang password yang dipilih pemilik; tidak menjadi password fallback/seed otomatis di source atau migration. Database baru memerlukan provisioning eksplisit.

## Phase2: master data

Endpoint privat `/employees` dan `/violation-types` tersedia untuk list/create/detail/update/archive/restore. Alias manual melalui `/employees/:id/aliases`; hanya alias yang dapat dihapus, bukan master. Semua mutation memakai session ADMIN, Origin dan X-CSRF-Token. List memakai default `status=ACTIVE`, `page=1`, `limit=20` (maks100); gunakan INACTIVE atau ALL bila diperlukan. Query q mencari nama/kode/alias karyawan, atau nama/kode/deskripsi jenis kesalahan; category memakai enum tetap.

Response list mengikuti `{data:[...],meta:{page,limit,total,totalPages}}`, response detail/mutasi `{data:...}`. Pembacaan count+rows memakai RepeatableRead dan sort createdAt/id desc. Kode karyawan opsional/nullable, di-trim dan uppercase; nama Unicode NFC/trim/collapse whitespace, normalized lowercase untuk search/alias. Nama utama boleh sama; alias tidak boleh ambigu dengan nama utama atau alias karyawan lain, termasuk yang diarsipkan. Namespace identitas dilindungi advisory transaction lock lintas instance API dan unique alias DB. Arsip mempertahankan referensi dan snapshot histori.

Audit before/after dipilih eksplisit dari field master, atomik dengan mutasi. Update jenis kesalahan memakai row lock; helper lockRow mengualifikasi schema supaya penguncian raw SQL konsisten dengan adapter Prisma dan schema QA. Tidak ada seed master/tarif otomatis. Deskripsi master dibatasi1.000 karakter; kode kesalahan2–40 A–Z/angka/-/_, kategori tetap, Rupiah integer1..100000000. Fitur Lainnya dibuat admin dengan tarif yang disetujui dan bisa diberi nominal manual saat modul kejadian tersedia.

`pnpm test:e2e` kini menjalankan suite foundation, auth-regressions dan master-data. Suite master menguji alias/nama concurrent, archive/restore, paging, validasi, retensi snapshot sintetis dan rollback bila audit gagal. Ini belum menguji posting asli yang merupakan Phase3.

Server browser QA membuat sesi master khusus pada schema acak dan storageState sementara berizin0600 di `/tmp/catat-denda-master-qa-session.json`; frontend tests/masters.spec.ts memakainya agar tes CRUD tidak melewati batas percobaan login. File dan schema dihapus saat Ctrl+C server QA. Tidak ada session fixture pada DB operasional.
