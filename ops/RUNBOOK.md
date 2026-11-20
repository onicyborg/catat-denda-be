# Catat Denda: operasi dan pemulihan

Template ini belum dipasang sebagai service. Rehearsal lokal tidak membuktikan kesiapan server/domain produksi. Tidak ada workflow GitHub atau deploy otomatis.

## Persiapan server

Gunakan Node 24, pnpm 10.33.1, PostgreSQL 17, client `pg_dump`/`pg_restore` yang kompatibel, OpenSSL, nginx dan systemd dengan dukungan LoadCredential. Pisahkan host/database/credential staging dan production. Akses PostgreSQL hanya dari private network/loopback; tidak ada port DB publik. Wajib storage database persisten, monitoring disk/inode, sinkronisasi waktu dan kapasitas. Bila memakai container, deklarasikan volume persisten dan restart policy sebelum aktivasi; compose development bukan konfigurasi produksi.

Siapkan release immutable yang terpisah untuk FE dan BE, masing-masing dengan node_modules sendiri. Service memakai akun OS `catat-api`, `catat-web`, `catat-backup` tanpa sudo. Sesuaikan `/usr/bin/node` dengan instalasi Node 24. Berkas kode dimiliki operator, bukan akun runtime. Siapkan `.next/cache` yang dapat ditulis `catat-web` sebelum menyalakan frontend. Database dan arsip tidak diletakkan di direktori release.

Salin `production.env.example` ke `/etc/catat-denda/backend.env` milik root mode0600, ganti semua placeholder. Buat SESSION_SECRET unik dengan `openssl rand -hex 32` melalui terminal privat/secret manager; jangan commit hasilnya. Origin harus HTTPS tanpa path. `TRUST_PROXY_LOOPBACK=true` hanya untuk topologi nginx satu host: API bind127.0.0.1 dan nginx **menimpa**, bukan meneruskan, X-Forwarded-For. Jangan membuka API secara langsung atau menambahkan proxy lain tanpa meninjau trust chain. Host yang masuk harus sama dengan APP_BASE_URL, termasuk port nonstandar. Default trust proxy adalah false.

## Pemisahan role DB

Operator DBA membuat database baru memakai template0 dan tiga LOGIN role berbeda, semuanya NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION: pemilik/migration, runtime, dan backup. Atur password melalui kanal privat, jangan argumen shell atau file Git. Pemilik migration memiliki database/schema public. Cabut CONNECT database dari PUBLIC lalu beri CONNECT kepada ketiganya; batasi pg_hba.conf untuk host/role/database yang sesuai. Runtime dan backup tidak menjadi anggota role pemilik atau pg_read_all_data dan tidak mempunyai privilege tambahan dari grup.

Dengan env pemilik hanya pada proses administrasi, jalankan `DATABASE_URL` pemilik untuk `pnpm prisma:deploy`, kemudian `MIGRATION_DATABASE_URL` pemilik untuk:

```sh
node scripts/ops/grant-runtime.mjs --runtime-role catat_runtime --backup-role catat_backup
```

Script grant menyasar schema public. Runtime dapat menjalankan operasi aplikasi tetapi tidak membuat tabel, menambah User, mengubah/menghapus AuditLog atau PaymentEntry. Backup hanya SELECT. Verifikasi membership/privilege efektif saat provisioning; script tidak mencabut keanggotaan role yang dibuat operator. Ulangi grant setelah setiap migrasi yang menambah tabel. Runtime hanya menerima DATABASE_URL runtime; credential migration tidak ikut service/backend.env.

## Release manual

Untuk deployment yang membawa18 kejadian awal yang diminta pemilik, ikuti [INITIAL-SEED.md](INITIAL-SEED.md): sesudah migration jalankan `pnpm db:seed` dengan role owner dan SEED_ADMIN_PASSWORD sementara. Seeder membuat defyana bila belum ada sehingga bootstrap terpisah tidak diperlukan. Ini data awal yang secara eksplisit diminta, bukan fixture QA; semua kejadian tetap DRAFT tanpa tanggal/jenis sampai ditinjau admin.

1. Catat SHA main FE/BE dan hash OpenAPI yang cocok, hasil UAT, audit, browser, load test dan restore. Tetapkan maintenance window serta operator pemulihan. Tinjauan kebijakan denda, akses dan retensi data usaha disetujui pemilik. Tidak ada fixture bisnis atau credential development dibawa ke produksi.
2. Di setiap checkout release, `pnpm install --frozen-lockfile`; BE `pnpm prisma:generate && pnpm build`; FE `API_INTERNAL_URL=http://127.0.0.1:3001 pnpm build`. Rewrites Next.js dibentuk saat build. Jangan memasang DATABASE_URL/secret di NEXT_PUBLIC_* atau bundle FE. Jalankan audit dan checks yang tercatat pada laporan QA.
3. Backup database sebelum migrasi dan verifikasi bahwa archive+manifest serta kunci bisa dibaca dari storage terpisah. Rehearse migrasi terhadap restore nonprod dengan akun/secret nonprod. Jangan menyalakan aplikasi hasil restore yang masih mempunyai session produksi; cabut AuthSession pada salinan dan gunakan SESSION_SECRET baru.
4. Hentikan penerimaan mutasi selama release. Dengan env owner sementara jalankan `pnpm prisma:deploy`, ulangi untuk memeriksa idempotensi, terapkan grant. Jangan memakai `prisma db push`, `migrate reset`, atau menyalakan aplikasi ketika migrasi gagal.
5. Provisioning admin satu kali memakai owner: isi ADMIN_BOOTSTRAP_USERNAME, ADMIN_BOOTSTRAP_PASSWORD dari kanal privat dan opsional email, jalankan `pnpm admin:bootstrap`. Gunakan password produksi baru; akun development tidak otomatis dibawa. Script menolak akun yang sudah ada dan tidak mereset password. Hapus variabel/file bootstrap setelah selesai; lakukan rotasi password melalui aplikasi bila diperlukan.
6. Pilih pasangan release BE/FE yang kontraknya cocok, pindahkan symlink `current`, restart service. Operator memeriksa `systemctl status`, `journalctl`, GET loopback `/api/v1/health/live`. Readiness privat memerlukan sesi admin serta Host yang benar. Nyalakan nginx setelah `nginx -t`; template `nginx/catat-denda.conf` dipasang dalam konteks http dengan domain dan sertifikat CA asli yang sudah diganti. Periksa HTTP redirect, TLS, HSTS, origin/CSRF, cookie Secure/HttpOnly/SameSite/Path, login, draft sintetis yang jelas, laporan dan logout. Readiness tidak dipublikasi oleh nginx.
7. Setelah smoke berhasil buka mutasi, catat SHA/waktu UTC, operator, versi PostgreSQL/node dan hasil. Pantau error5xx, konflik409, login429, durasi/p95 serta DB pool. Jangan menganggap systemd atau timer aktif sebelum ada bukti dari host tujuan.

`systemd/*.service`/timer adalah template; periksa `systemd-analyze verify`, path, user dan mount di host tujuan sebelum instalasi/enable. DB runtime harus mampu pulih sendiri setelah reboot; health/readiness bukan restart controller. FE/BE restart on-failure dengan batas5 permenit, alarm wajib ketika batas tercapai.

## Backup terenkripsi

Siapkan `/mnt/catat-backups` sebagai mount storage terpisah dari host/volume database, mode0700, owner catat-backup. Bukti upload/mount off-host dan pembacaan ulang dari lokasi lain wajib sebelum readiness. Backup harian minimal; timer template berjalan setiap12jam UTC dengan Persistent=true untuk memberi ruang terhadap target RPO24jam. Kegagalan job tidak boleh dianggap backup berhasil; alarm ketika umur snapshot sukses >18jam, eskalasi sebelum24jam. Cek durasi, exit status, checksum/manifest, kapasitas dan akses setiap job. Timer belum dipasang oleh pekerjaan ini.

Buat kunci random minimal32byte di `/etc/catat-denda/backup.key` root0600, simpan salinan terenkripsi di secret manager/lokasi pemulihan yang terpisah dari arsip. `/etc/catat-denda/backup.env` root0600 hanya berisi BACKUP_DATABASE_URL role SELECT. Systemd LoadCredential menyediakan key kepada akun backup. Jalankan manual memakai environment privat:

```sh
pnpm backup:create --output /mnt/catat-backups --key-file /path/private/backup.key --prune
```

Format custom pg_dump dienkripsi streaming AES-256-GCM, salt16/IV12 acak, key scrypt N32768/r8/p1. Header diautentikasi; tag16, SHA256 manifest untuk deteksi kerusakan. URL password tidak masuk argumen child process, pgpass0600 sementara dibersihkan. Tolak credential di query URL. File parsial bukan backup sukses. Backup arsip+manifest private dan hanya dipruning jika pasangan/checksum valid; semua snapshot14hari terakhir dan minimal14 recovery point disimpan. File lain tidak dihapus. Pantau orphan/partial files untuk cleanup manual setelah investigasi.

Kehilangan kunci berarti backup tidak dapat dipulihkan. Saat rotasi key, pertahankan key lama hingga semua arsip yang memakainya habis masa retensi; label key/version di inventaris operator, jangan mencampur key tanpa mapping arsip. Rotasi credential backup dan session mengikuti runbook secret manager organisasi.

## Restore dan gangguan

1. Hentikan mutasi dan catat waktu insiden/snapshot terakhir sukses. Pilih arsip+manifest lengkap dari storage terpisah dan key yang cocok; ukur kehilangan data sejak **awal snapshot**, bukan waktu upload.
2. Buat database tujuan baru, kosong, template0, dengan owner pemulihan dan akses nonpublik. Jangan menimpa database asal. RESTORE_DATABASE_URL memakai target baru dan owner lewat environment privat. Pakai TMPDIR pada tmpfs/private encrypted disk dengan kapasitas mencukupi: restore mengautentikasi seluruh arsip sebelum pg_restore sehingga plaintext sementara diperlukan dan selalu dibersihkan pada exit normal. Setelah crash operator memeriksa direktori catat-restore-* private sebelum reuse host; jangan membuat dump plaintext di shared storage.

```sh
pnpm backup:restore --archive /mnt/catat-backups/SELECTED.dump.enc --key-file /path/private/backup.key --confirm-database NEW_DATABASE_NAME
```

3. Restore menolak key salah, ciphertext rusak, nama konfirmasi berbeda dan target berisi relasi. pg_restore memakai single transaction/exit-on-error/no-owner/no-acl, tanpa --clean. Jangan membiarkan proses lain mengisi target saat restore. Role/ACL cluster tidak disimpan dalam dump; provision ulang role/CONNECT lalu jalankan grant-runtime. Jangan menjalankan bootstrap pada DB hasil restore yang sudah berisi admin.
4. Verifikasi semua migration terpasang, jumlah kasus/alokasi/ledger/audit, nominal saldo/report, login/readiness serta payment dan reversal sintetis pada nonprod. Cabut sesi lama, rotasi SESSION_SECRET dan credential DB sebelum cutover. Target RTO24jam mencakup deteksi, provisioning, transfer, restore, verifikasi dan cutover; waktu restore lokal saja bukan janji RTO produksi.
5. Cutover hanya setelah review operator; simpan DB lama read-only untuk investigasi. Jika aplikasi gagal sesudah migrasi, utamakan forward fix. Rollback binary hanya jika schema masih kompatibel; jangan rollback schema otomatis. Jika harus kembali ke snapshot, catat potensi transaksi hilang dan rekonsiliasi dengan pemilik sebelum membuka mutasi. Lakukan drill restore minimal bulanan dan setiap perubahan format backup/migrasi besar.

Untuk409 stale version: baca ulang detail dan minta pengguna mengonfirmasi ulang. Untuk409 retryable busy: ulangi aksi yang sama dengan **idempotency key yang sama** dan backoff terbatas. Jangan membuat key baru hanya karena timeout; periksa transaksi yang mungkin sudah berhasil. Jangan edit/delete ledger lewat SQL; pembetulan memakai reversal yang diaudit. Jika integritas diragukan, hentikan mutasi dan pulihkan dari bukti, bukan menebak saldo.

## Monitoring dan secret

Log API JSON berisi requestId acak, method, route template, status, durationMs dan UTC; query/body/header/cookie/password tidak dicatat. RequestId dapat dikorelasikan dengan balasan API. Batasi akses/retensi journal dan nginx error log, jangan mengaktifkan debug/request-body logging. Pantau disk/inode (>80%warning/>90%critical), memory, restart, pool/locks, backup freshness, sertifikat kedaluwarsa, error5xx dan p95. Hubungkan alert ke kanal/operator yang ditetapkan sebelum rilis; belum ada provider monitoring produksi terhubung.

SESSION_SECRET baru mengubah token CSRF; untuk rotasi yang mencabut seluruh login, hapus AuthSession secara terkontrol dengan owner, restart API lalu login ulang. Password DB dirotasi lewat kanal DBA privat, perbarui env service0600 dan restart; verifikasi koneksi sebelum mencabut credential lama. Jangan memasukkan secret ke shell history, log, issue, screenshot atau Git.

Referensi: [PostgreSQL17 SQL dump/restore](https://www.postgresql.org/docs/17/backup-dump.html), [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html). Panduan self-host Next.js yang dipakai sesuai versi terpasang di node_modules/next/dist/docs/01-app/02-guides/self-hosting.md.

## Menjalankan rehearsal HTTPS lokal

Build backend dengan `pnpm build` dan frontend sibling dengan `NEXT_TEST_DIST_DIR=.next-release pnpm build`. Jalankan backend `pnpm test:https:server`, lalu frontend `pnpm test:release`. Terakhir jalankan backend `node scripts/verify-https-edge.mjs` untuk uji throttle/spoof XFF; kuota login sengaja dikonsumsi. Ctrl+C membersihkan schema/sesi QA, proxy dan sertifikat sementara. Harness menolak URL database non-loopback dan port yang sudah dipakai, menggunakan nginx image yang dipin digest dan template yang sama dengan produksi (domain/port/sertifikat disesuaikan untuk localhost). Service systemd tidak diaktifkan oleh harness. Setelah crash, inventarisasi artefak QA sebelum cleanup manual; jangan menghapus schema milik proses lain.
