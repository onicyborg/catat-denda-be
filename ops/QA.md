# Phase6: hasil rehearsal lokal

Tanggal20 November2026. Pengguna menyatakan belum ada staging/domain dan memilih rehearsal lokal. **Rehearsal lokal selesai; readiness staging/produksi belum disetujui dan belum ada deployment.** Seluruh fixture berada dalam schema/database acak yang dibersihkan; tidak mengubah data bisnis operasional.

## Perubahan

Production menolak APP_BASE_URL HTTP dan Host yang tidak cocok, kecuali liveness loopback GET/HEAD. Trust proxy eksplisit defaultfalse; template same-host nginx menimpa XFF dan API hanya loopback. Log API mencatat route template/durationMs/requestId/UTC tanpa query, body, cookie atau secret. Query sentinel redaction tidak muncul pada log rehearsal.

Ekspor laporan kini disabled selama transisi filter URL, mencegah CSV menggunakan filter lama ketika diklik tepat setelah Terapkan periode. Tes browser menahan request navigasi, memeriksa kedua tombol disabled, lalu memastikan ekspor memakai rentang baru.

Audit menemukan24 advisory BE (23 dari tooling deploy Nest yang tidak digunakan,1 effect transitif Prisma) dan1 FE (minimatch transitif shadcn). Tool deploy yang belum dipakai dihapus, effect dipin3.22.1 dan minimatch transitif dipin11.0.1; shadcn CLI dipindahkan ke devDependencies. Audit ulang seluruh dependensi BE/FE:0 advisory. Rujukan perbaikan: [effect](https://github.com/advisories/GHSA-7589-6fvf-x4pw), [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249). CLI shadcn help, build, lint dan browser tetap lulus. Preset tidak diganti.

## Checks yang dijalankan

| Check | Hasil |
|---|---|
| BE lint, typecheck, build | PASS |
| BE unit Vitest |13/13 PASS |
| BE6 runner integration | PASS foundation/auth regressions/master/fines/payments/reporting |
| Foundation NODE_ENV=production | PASS Secure cookie, Host/origin/CSRF/revoke/expiry/throttle/constraints |
| Fixture lokal nyata18 item | PASS15 POSTED,20 alokasi,105000,3 DRAFT,0 pembayaran |
| FE lint, typecheck, build | PASS |
| FE regresi browser yang sudah ada |27/27 PASS |
| Regresi baru transisi filter/CSV |1/1 PASS, request navigasi ditahan secara deterministik |
| HTTPS Next build+API production+nginx |3/3 PASS Chrome, Firefox, WebKit iPhone13 simulation |
| HTTPS edge | PASS redirect308, private no-store, Host/origin, readiness privat, spoof XFF tidak lolos throttle |
| Clean copies, pnpm install --frozen-lockfile --offline | BE/FE PASS, masing-masing node_modules sendiri |
| Fresh Prisma generate/build dan Next build | PASS pada copy tanpa env, node_modules, dist atau cache build lama |
| Migrasi5 versi, migrate deploy2 kali | PASS database baru template0, tanpa db push |
| systemd-analyze verify templates | PASS; service/timer belum diinstal/diaktifkan |
| Contract OpenAPI | SHA256 BE/FE sama: cc5d7ff3b5a0cd953bd8f7bccd5c9cc4c6cc8cb4e806f86e6682bda75aea5cac |

## Load test

Nodev24.14.1, PostgreSQL17.12,20 CPU tersedia/15GiB RAM, loopback Linux.10.000 POSTED,40.000 alokasi,20.000 ledger,10 admin paralel. Tiap endpoint1 warmup/admin+8 pengukuran/admin =80 sampel,480 sampel total; endpoint diuji bergiliran,10 admin bersamaan per endpoint. Data SQL diverifikasi assessed200000000/outstanding170000000. Ini closed-loop smoke load lokal dengan indeks dianalisis, bukan kapasitas staging, soak test atau jaminan throughput produksi. Durasi mencakup request HTTP localhost, tanpa TLS/jaringan eksternal.

| Route | Sampel | p50ms | p95ms | maxms | Lokal |
|---|---:|---:|---:|---:|---|
| `/fine-cases?limit=20` | 80 | 52.41 | 118.9 | 154.75 | PASS |
| `/payments?limit=20` | 80 | 62.29 | 89.39 | 102 | PASS |
| `/dashboard/summary?from=2026-01-01&to=2026-01-31` | 80 | 459.73 | 517.88 | 561.52 | PASS |
| `/reports/summary?from=2026-01-01&to=2026-01-31` | 80 | 121.93 | 160.8 | 171.16 | PASS |
| `/reports/employee-balances?from=2026-01-01&to=2026-01-31` | 80 | 169.26 | 229.12 | 243.18 | PASS |
| `/audit-logs?limit=20` | 80 | 47.82 | 72.17 | 80.4 | PASS |

Dashboard production hangat terukur **562ms**, dari navigasi sampai response data200 dan tombol Keluar enabled. Chrome390×844, latency40ms, unduh1.6Mbps/unggah0.75Mbps, CPU4×, aset telah dimuat. Dataset UI disposable kosong; ini terpisah dari benchmark API10.000 kasus. Bukan full Lighthouse/field TTI, pengukuran cold load, atau pengukuran gabungan dataset10k di staging. Browser smoke tidak menghasilkan pageerror. WebKit menunggu prefetch selesai sebelum full document reload agar abort RSC yang dibuat harness tidak disalahartikan sebagai runtime app.

WebKit Linux memerlukan libavif16/libgav1/libyuv dari paket Ubuntu noble yang diekstrak ke cache browser pengguna; tidak menginstal/mengubah library sistem. WebKit iPhone simulation tidak menggantikan Safari/iOS nyata. Pengujian yang ada mencakup360–1440px, light/dark, keyboard/dialog, label/focus, overflow dan pemeriksaan kontras otomatis; screenshot desktop laporan dan mobile gelap diperiksa visual. Audit WCAG tersertifikasi/screen reader nyata belum dilakukan.

## Backup dan recovery

AES256GCM/scrypt, key private, pg_dump custom read-only role, manifest/checksum dan file atomik. Restore mengautentikasi ciphertext sebelum pg_restore single-transaction ke database baru/kosong. Key salah, ciphertext diubah walau checksum diperbarui, key mode0644, target nonempty dan salah konfirmasi DB semuanya ditolak. Uji retensi16 recovery point menghasilkan14 tersisa,2 lama dihapus; unrelated.txt tetap ada.

Dump terenkripsi **36091byte**, restore **164.5ms**, seluruh rehearsal recovery **8.895detik**. Umur snapshot teramati kira-kira **3.160detik** sejak awal job backup sampai akhir smoke. Snapshot pg_dump diambil saat awal dump; angka lokal ini bukan bukti scheduler/off-host/target RPO operasional24jam. RTO produksi harus mencakup deteksi, transfer, provisioning, validasi dan cutover.

Jumlah data sebelum/sesudah restore identik:5 migration,1 admin,1 employee,1 type,1 case,1 member,1 payment,7 audit. Smoke dijalankan dengan owner lalu akun runtime terbatas: login/readiness/case/report/ledger, tambahan payment+reversal dan perubahan password berhasil. Runtime ditolak saat CREATE/DROP tabel, INSERT user, UPDATE isActive, UPDATE audit dan DELETE ledger. Runtime hanya dapat UPDATE kolom passwordHash/lastLoginAt/updatedAt pada User. Saldo kembali3000 setelah payment/reversal QA. Tidak ada data uji yang dipindah ke database bisnis.

Bukti JSON tersanitasi berada di [evidence/](evidence/). Runbook dan konfigurasi di [RUNBOOK.md](RUNBOOK.md), [nginx/](nginx/), [systemd/](systemd/). Deployment/recovery operator wajib memakai domain, cert CA, secret, DB private dan role berbeda yang benar-benar diverifikasi.

## Reproduksi

Di backend: `pnpm test`, `FINE_QA_SAMPLE_FILE=/path/to/local/05_SAMPLE_MIGRATION_CASES.json pnpm test:e2e`, `NODE_ENV=production node scripts/verify-foundation.mjs`, `pnpm test:performance`, `pnpm test:recovery`. Runner memerlukan PostgreSQL lokal nonprod dan hak membuat schema; recovery memerlukan hak membuat database/role disposable. Jangan memakai credential produksi.

Untuk HTTPS: build backend; di frontend `NEXT_TEST_DIST_DIR=.next-release pnpm build`; backend `pnpm test:https:server`; frontend `pnpm test:release`; terakhir backend `node scripts/verify-https-edge.mjs` (tes throttle sengaja menghabiskan kuota login). Hentikan server dengan Ctrl+C untuk cleanup. Harness memerlukan checkout sibling frontend/backend, Podman rootless/image nginx yang dipin, OpenSSL, port3080/3200/3201/3443 bebas, dan database lokal. Sertifikat private dan sesi QA dibersihkan saat exit normal. Sesudah crash periksa schema qa_* dan direktori catat-https-* secara manual; jangan drop schema yang sedang dipakai runner lain.

## Gate eksternal yang masih terbuka

- Server staging/domain/cert CA belum tersedia. Ulangi HTTPS,10k/10admin, browser dan ukuran halaman pada target sebenarnya.
- Storage off-host/mount terpisah, timer backup12jam (minimal harian), retensi14hari, alert freshness/kapasitas dan restore drill produksi belum diaktifkan/diverifikasi.
- Boot/restart/persistensi database, service user/firewall/privilege efektif, provider monitoring dan kanal alert harus diperiksa pada host tujuan.
- Safari/iOS fisik dan persetujuan pemilik terhadap kebijakan denda/akses/retensi data usaha belum diverifikasi.
- Deploy hanya setelah kesiapan diverifikasi dan rilis diminta. Workflow development/GitHub tetap ditunda.
