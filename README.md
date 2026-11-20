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

Migration harus versioned; `pnpm prisma:migrate --name <nama>` hanya development, `pnpm prisma:deploy` untuk deployment. Endpoint master, kejadian dan pembayaran tersedia setelah Phase1–4; laporan dan audit viewer mengikuti Phase5. Backup/restore dan production deployment dituntaskan Phase6. Kredensial Compose hanya lokal, DB port5433.

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

## Phase3: kejadian dan alokasi

API privat `/fine-cases` menerima create DRAFT, list/detail dan PATCH. Transisi `POST /:id/post` serta `POST /:id/void` memerlukan `version`; void juga memerlukan alasan5–500 karakter. PATCH memerlukan version yang dibaca sebelumnya. Konflik versi/lifecycle mengembalikan409; validasi422. Create wajib header UUID `Idempotency-Key`: simpan key dan payload asli sampai respons terkonfirmasi. Replay actor+payload yang sama memulihkan case yang sama, payload/actor berbeda409. Mapping disimpan permanen melalui FineCaseCreation; tidak ada expiry yang bisa menggandakan retry lama. Header tetap wajib Origin dan X-CSRF-Token.

Draft mengizinkan tanggal/jenis/nominal/identitas belum lengkap, 0–20 peserta; rawEmployeeName dan sourceText dipertahankan. Posting memerlukan tanggal maksimal sekarang+5menit, deskripsi3–1000, jenis aktif dan1–20 karyawan aktif berbeda dengan integer Rp1..Rp100.000.000 per peserta. Total dihitung sebagai SUM alokasi. previewAmount draft terpisah dari assessedAmount/netPaidAmount/outstandingAmount aktif; aggregate berupa string desimal. Status pembayaran diturunkan dari ledger PAYMENT minus REVERSAL, tidak dapat diedit langsung. DRAFT/VOIDED mempunyai saldo aktif0 dan settlementStatus null. nominal null tetap null, bukan nol.

Posting mengambil snapshot nama/kode/kategori/tarif jenis dan nama peserta secara atomik. Koreksi nominal saja mempertahankan snapshot lama; penggantian jenis atau peserta sebelum ledger mengambil snapshot master aktif untuk referensi yang diganti. Referensi tetap yang sudah diarsipkan tidak memaksa penulisan ulang histori ketika nominal/catatan dikoreksi. Setelah pernah ada ledger, termasuk yang dibalik seluruhnya, hanya deskripsi dapat dikoreksi; sourceText posting tidak dapat diubah. Void membutuhkan setiap alokasi netPaid0 dan bersifat terminal; ledger/histori tetap tersimpan.

Protokol lock untuk Phase4: transaksi selalu mengunci FineCase dulu, kemudian FineCaseMember terurut ID. Posting/koreksi mengambil lock master jenis lalu employee terurut ID untuk snapshot. Semua transisi, version increment dan audit before/after berada pada transaksi yang sama. Endpoint pembayaran Phase4 harus mengikuti urutan case→member dan membaca ulang lifecycle/version/balance setelah lock.

List menerima q, status DRAFT/POSTED/VOIDED, employeeId, violationTypeId, from/to tanggal WIB, page dan limit. Batas akhir tanggal inklusif dalam WIB, diterjemahkan menjadi interval UTC setengah terbuka. Default semua status; sort createdAt/id desc, count+rows RepeatableRead. Ledger pada response detail bersifat readonly dan hanya berisi field tampilan, tanpa requestHash/idempotency key.

Suite `pnpm test:e2e` menyertakan verify-fine-cases.mjs: posting nyata, snapshot, koreksi, validasi, replay/concurrency dan rollback audit. Helper scripts/fixtures-fines.mjs hanya dipakai runner QA pada schema acak. Untuk memverifikasi file contoh lokal tanpa menyalin data bisnis ke repo: `FINE_QA_SAMPLE_FILE=/path/05_SAMPLE_MIGRATION_CASES.json node scripts/verify-fine-cases.mjs` sesudah build. Seluruh18 kasus dimulai DRAFT dengan tanggal/ID kosong. Tanggal, mapping identitas dan jenis pada langkah konfirmasi tes adalah input sintetis eksplisit;15 kasus bernominal dikonfirmasi sehingga total105.000, tiga tanpa nominal tetap draft. Tidak ada import UI/seed operasional atau pembayaran otomatis.

## Phase4: pembayaran dan pembalikan

API privat:

- `POST /fine-members/:id/payments` menerima amount integer1..100000000 dan <=sisa, method CASH/TRANSFER/OTHER, effectiveAt RFC3339 maksimal sekarang+5menit, note opsional maksimal1.000 karakter.
- `POST /payments/:id/reverse` menerima reason5–500 dan effectiveAt >=pembayaran asli serta <=sekarang. Nominal/member/referensi berasal dari pembayaran asli, bukan input client. Pembalikan penuh satu kali; tidak dapat membalik REVERSAL atau case DRAFT/VOIDED.
- `GET /payments` memakai filter from/to tanggal efektif WIB, employeeId, caseId, kind PAYMENT/REVERSAL, page/limit. Sort effectiveAt/createdAt/id desc, count+rows RepeatableRead; index global ditambah migration004.
- `GET /payments/:id` mengembalikan field ledger immutable, aktor, snapshot peserta/kode kejadian, referensi pembayaran/pembalikan dan izin aksi terkini. Tidak ada PATCH/DELETE ledger atau pengubahan settlement manual.

Kedua mutation memerlukan Origin, CSRF dan UUID Idempotency-Key. Satu namespace key mencakup PAYMENT/REVERSAL beserta target; canonical hash memasukkan operasi, target UUID lowercase, nominal/metode/tanggal ISO ternormalisasi dan catatan/alasan trim. Key sama+actor/payload sama memulihkan entry yang sama, termasuk setelah case dibatalkan; perbedaan actor/target/operasi/payload409. Ledger menyimpan key/hash permanen dan tidak mengeluarkannya melalui response. Field izin/referensi terkait pada receipt mencerminkan kondisi saat dibaca; identitas dan nilai transaksi asal tetap sama.

Setiap transaksi mengambil advisory lock key lalu lock FineCase→FineCaseMember, membaca ulang lifecycle/saldo dan menulis ledger+version case+audit atomik. Master yang kemudian diarsipkan tetap dapat menerima pembayaran untuk alokasi historis POSTED. Audit gagal membatalkan ledger dan increment version. Pembayaran aktif menghalangi void; setelah reversal penuh void boleh, sementara koreksi finansial tetap terkunci karena pernah ada ledger.

Lock timeout1.500ms, transaction timeout10detik/maxWait5detik dan maksimal3 percobaan untuk konflik/timeout transaksi P2034/P2028 atau SQLSTATE40001/40P01/55P03. Bila habis,409 dengan `error.details.retryable=true`; ulangi key/payload yang sama. Error bisnis409 dan validasi422 bukan instruksi membuat transaksi pengganti secara otomatis. Unknown failure tetap500 tanpa detail internal. FE mempertahankan key/payload saat koneksi/5xx/429/retryable409 belum pasti; error definitif4xx membolehkan koreksi input. Respons berhasil selalu diikuti refresh saldo backend.

[Idempotency bawaan Nest](https://docs.nestjs.com/reliability/idempotency) ditinjau sebelum implementasi. Untuk ledger ini deduplikasi menggunakan unique key pada PaymentEntry dalam transaksi bisnis yang sama dengan uang dan audit, sehingga tidak memerlukan store/cache terpisah atau dependency baru. Ini juga mempertahankan kontrak409 dan retensi permanen yang dipilih proyek.

`pnpm test:e2e` menyertakan verify-payments.mjs pada schema acak: pembayaran2k+3k, overpayment, replay lintas operasi/target/actor, dua pembayaran/reversal, VOID/PATCH bersamaan dengan PAYMENT, lock timeout PostgreSQL nyata dan audit rollback. Ringkasan per-karyawan diverifikasi terhadap member/case pada DB QA; endpoint/UI summary employee dan dashboard agregat menjadi Phase5. Runner browser QA tetap khusus port3101, tanpa seed bisnis/ledger pada schema operasional.

## Phase5: dashboard, laporan, audit dan pengaturan

Endpoint private ADMIN: GET `/dashboard/summary`, `/reports/summary`, `/reports/employee-balances`, `/reports/fine-cases`, `/employees/:id/summary`, `/reports/fine-cases.csv`, `/reports/payments.csv`, `/audit-logs`, `/audit-logs/options`, serta GET/PATCH `/settings`.

Semua periode memakai from/to YYYY-MM-DD WIB inklusif; default bulan berjalan menurut UTC+7, bukan timezone host. ReportQuery mendukung employeeId/violationTypeId. Ringkasan mengembalikan caseCount DISTINCT dan allocationCount; assessedAmount menurut occurredAt case POSTED; periodNetPaidAmount menurut effectiveAt ledger, termasuk cashflow historis case yang kemudian VOIDED; currentOutstandingAmount seluruh POSTED lintas periode sesuai filter identitas/jenis. cohortNetPaidAmount/cohortOutstandingAmount merupakan pembayaran kumulatif/sisa kasus occurredAt periode. Nilai agregat string desimal. Ledger dijumlah per member sebelum join ke alokasi, sehingga cicilan tidak menggandakan assignedAmount. Semua query terkait dalam satu response memakai RepeatableRead.

Employee-balances bersifat kohort occurredAt dengan pembayaran kumulatif hingga kini; sort sisa DESC/nama/ID. Filter employee pada rekap case/CSV menjumlah hanya alokasi employee itu, bukan seluruh peserta case. Jumlah case per employee tidak boleh dijumlahkan untuk mencari total kejadian lintas employee; summary memakai COUNT DISTINCT. Dashboard menyertakan5 case terbaru menurut occurredAt,5 draft dan count seluruh draft, serta5 karyawan sisa terbesar lintas periode. Profil karyawan mendapat summary, daftar kohort dan ledger bertanggal efektif dengan paging di frontend.

Report cases memakai status POSTED(default)/DRAFT/VOIDED/ALL; includeUndated=true menyertakan tanggal null secara eksplisit. Status/undated hanya berlaku pada daftar/CSV case, bukan KPI aktif. CSV case satu baris/member; case tanpa member tidak menghasilkan baris walaupun tampil di daftar. assigned_amount_idr mempertahankan nominal historis/preview yang diketahui, null tetap kosong. net_paid/outstanding/settlement kosong untuk DRAFT/VOIDED. Nama DRAFT adalah preview dari nama sumber/master, belum snapshot posting. CSV payment satu baris/entry, amount positif dan signed_amount_idr negatif untuk reversal; tidak mengeluarkan ledger historis karena case VOIDED.

CSV berkolom persis SRS, UTF-8 BOM, delimiter koma, RFC4180 quoting dan CRLF. Semua string diquote/escape; teks dengan pemicu formula ASCII/full-width setelah whitespace/control/invisible prefix diberi apostrof. Nominal typed integer/BigInt tidak diubah. Pertimbangan berdasarkan [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection); mitigasi berlaku pada file asal yang diekspor, bukan jaminan terhadap setiap perilaku penyimpanan ulang/perubahan oleh spreadsheet. Tidak mengeksekusi formula atau melakukan import CSV.

CSV_MAX_DAYS(default366,max3660) dan CSV_MAX_ROWS(default10000,max50000) tervalidasi pada environment. Server membaca cap+1 dan menolak422 bila terlalu besar, tanpa truncation; header-only CSV untuk hasil kosong. Header attachment berfilename statis+tanggal tervalidasi, no-store. StreamableFile native Nest dikembalikan tanpa envelope JSON. Export audit sukses ditulis sebelum file dikirim, hanya filter/count/format, tidak menyimpan isi file. Jika audit gagal, response JSON500 dan file tidak dikirim. Cap awal diuji lokal; volume/staging dan perf release diuji Phase6.

Audit viewer read-only memakai filter from/to, actorUserId UUID, action, entityType, page/limit. Options memberi label aktor dan nilai aksi/entitas aktual tanpa credential. Reader memilih field metadata, whitelist payload, menghilangkan field rahasia dan membatasi string2.000 karakter, kedalaman5, array50 serta budget tampilan16.000 karakter per sisi; data audit asli tidak ditulis ulang. Writer tetap wajib memilih payload nonsecret. UI menerangkan pemotongan tampilan. Tidak menyediakan update/delete audit.

Settings GET tidak membuat row; fallback nama Catat Denda/IDR/Asia/Jakarta/version0 saat belum dikonfigurasi. PATCH memerlukan version, businessName opsional2–150 NFC/trim/collapse, finePolicyReference opsional nullable max2000; minimal satu field perubahan. Null businessName dan upaya mengubah currency/timezone/actor ditolak422. Advisory lock singleton dan version check menghasilkan409 pada stale edit. Settings+audit atomik; versi disimpan melalui migration005. Audit entityId singleton dipetakan ke UUID stabil00000000-0000-4000-8000-000000000001 agar kompatibel dengan tipe AuditLog.entityId; entityType AppSettings merujuk row1. Nama usaha ditampilkan di header/report UI; CSV tetap mengikuti kolom SRS.

Suite test:e2e kini menjalankan6 runner. verify-reporting.mjs menguji kasus4 member/20k dengan beberapa pembayaran, A/B/C cohort-cashflow-reversal, batas WIB/leap/year, employee filter, CSV security/precision/limits/rollback, audit safe payload/options/paging, settings race/partial PATCH/rollback dan fixture18 kasus. `FINE_QA_SAMPLE_FILE=/path/05_SAMPLE_MIGRATION_CASES.json node scripts/verify-reporting.mjs` memakai contoh lokal secara eksplisit pada schema QA:15 POSTED/20 alokasi/105000 tanpa pembayaran,3 draft unknown. Tidak menyalin dokumen bisnis atau membuat seed operasional.

## Phase6: rehearsal dan operasi

Hasil checks serta batas validasi lokal tersedia di [ops/QA.md](ops/QA.md). Gunakan [runbook](ops/RUNBOOK.md) untuk provisioning role, frozen-lockfile release, nginx HTTPS, systemd, bootstrap, backup AES256GCM, restore ke DB baru, rotasi dan konflik transaksi. Semua template belum diaktifkan pada server produksi.

`pnpm test:performance` memakai10k kasus/10admin pada schema QA. `pnpm test:recovery` membuat DB/role disposable untuk migrasi, backup/restore dan smoke least privilege. `pnpm test:https:server` menyalakan rehearsal HTTPS lokal dengan checkout frontend sibling yang sudah dibuild ke .next-release; jalankan `pnpm test:release` pada frontend dan `node scripts/verify-https-edge.mjs` terakhir, lalu Ctrl+C untuk cleanup. Lihat runbook dan laporan untuk prasyarat. Jangan gunakan runner QA dengan credential produksi.
