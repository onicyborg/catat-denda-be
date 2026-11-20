# Deployment backend

Workflow `Build and deploy` memverifikasi push ke `main` dan `development`.
Hanya `development` yang menerbitkan image dan deploy ke Environment `development`.
Push workflow ini pertama kali dilakukan di `development`; merge ke `main` melalui GitHub untuk mengaktifkan verifikasi pada branch tersebut.

## GitHub Environment development

Secrets: `VPS_HOST`, `VPS_PORT` (default 4238), `VPS_USER`, `VPS_SSH_PASSWORD`,
`VPS_KNOWN_HOSTS` (hasil pin identitas SSH server), dan `VPS_ENV` (dotenv multiline).
Password SSH disesuaikan dengan secret yang sudah tersedia; koneksi memakai pemeriksaan host key wajib.
Variables: `VPS_API_APP_DIR=/srv/catat-denda/backend`,
`BACKEND_DOMAIN=api-catat-denda-berkop.geats.web.id`,
`FRONTEND_ORIGIN=https://catat-denda-berkop.geats.web.id`.

`VPS_ENV` berisi `DATABASE_URL`, `SESSION_SECRET`, opsional `SESSION_TTL_HOURS`,
`CSV_MAX_DAYS`, `CSV_MAX_ROWS`, `MIGRATION_DATABASE_URL` (direct Neon),
`DATABASE_URL_UNPOOLED` (fallback direct), dan `SEED_ADMIN_PASSWORD` untuk provisioning.
Deploy menentukan port 3001, production, proxy loopback dan kedua origin dari variables di atas.
Vercel memerlukan `API_INTERNAL_URL=https://api-catat-denda-berkop.geats.web.id`, lalu redeploy karena rewrite dibentuk saat build.

## Topologi

Managed domain provider menangani HTTPS dan meneruskan Host API ke port privat 8080 VPS.
Nginx VPS memiliki virtual host Catat Denda terpisah, meneruskan hanya `/api/v1/`
ke `127.0.0.1:3001`. Docker menggunakan Linux host networking sehingga bind loopback
aplikasi tetap privat. Container non-root, filesystem read-only, tanpa capabilities.
Port 8080 dipakai bersama virtual host layanan lain; konfigurasi layanan lain tidak diubah.
Endpoint readiness tidak diterbitkan melalui Nginx. Origin penulisan tetap hanya frontend.
Nginx menimpa header forwarded dari peer langsung; rate limit mengikuti IP peer yang dipercaya,
sehingga pengguna melalui gateway/proxy yang sama dapat berbagi kuota login.

## Urutan dan pemulihan

Image admin dan runtime terpisah; keduanya dikunci digest SHA-256. Unduhan dibatasi
180 detik per percobaan dengan maksimal tiga percobaan. Job administrasi memakai
jaringan host dengan resolver container 1.1.1.1/9.9.9.9 karena DNS default VPS kadang timeout. Konfigurasi DNS layanan lain tidak diubah. Migrasi `deploy`
dan seed idempotent berjalan memakai owner direct; tidak ada reset database.
Provisioning membuat role runtime dan backup terpisah. Runtime tidak mendapat hak DDL,
penghapusan ledger, atau pengubahan audit. `.db-roles.json` harus disimpan privat dan
dicadangkan terenkripsi bersama konfigurasi server; kehilangan file memerlukan rotasi role.
Credential owner dan seed dihapus dari staging setelah job selesai dan tidak masuk container runtime.

Deploy memakai lock, healthcheck, batas resource/log, dan pemulihan image/env/Nginx
sebelumnya jika rollout gagal. Migrasi database tidak dibatalkan otomatis; gunakan
migrasi kompatibel dengan versi sebelumnya. Job akan gagal jika konfigurasi atau
pengujian gagal. Backup terenkripsi terjadwal/off-host mengikuti `ops/RUNBOOK.md` dan
memerlukan storage serta key operator; workflow ini tidak mengaktifkan jadwal backup.

Validasi lokal: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`,
`pnpm test:uuid`, `node --test deploy/prepare-env.test.mjs`, `bash -n deploy/deploy.sh`.
