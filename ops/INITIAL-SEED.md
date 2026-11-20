# Inisiasi data awal

Seeder ini berisi data awal nyata yang diberikan pemilik pada20 November2026, bukan fixture QA. Sumber berada di prisma/initial-data.ts. Username admin adalah `defyana`; password tidak di-hardcode atau dimasukkan ke audit/log/Git. Supply `SEED_ADMIN_PASSWORD` lewat environment privat/secret manager ketika membuat akun baru. Input10–256 karakter mendukung password yang sebelumnya dipilih pemilik; gunakan credential deployment yang disetujui pemilik. Akun yang sudah ada tidak direset, diaktifkan ulang atau diganti role-nya oleh seeder.

## Jalankan

Pada checkout/backend dengan Node24, pnpm10.33.1 dan seluruh dependency tooling terpasang:

```sh
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:deploy
pnpm db:seed
```

Sebelum perintah terakhir, isi DATABASE_URL target dengan role owner/provisioning dan SEED_ADMIN_PASSWORD di environment privat. Pastikan target database benar; CLI tidak mengubah/menghapus database lain. Jangan memakai akun runtime untuk provisioning: runtime memang tidak memiliki INSERT User. Setelah berhasil, hapus variable/file password seed dan lanjutkan grant runtime/backup pada runbook. Bila seed sudah membuat admin, tidak perlu menjalankan admin:bootstrap secara terpisah. `prisma migrate deploy` tidak otomatis menjalankan seed; `pnpm db:seed` adalah langkah eksplisit menurut [dokumentasi Prisma7](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding).

Environment service aplikasi tidak perlu menyimpan SEED_ADMIN_PASSWORD. Job seed membutuhkan Prisma CLI/tsx yang berada di devDependencies; jalankan sebagai job administrasi dari checkout penuh/builder, bukan container runtime yang dipangkas dengan --prod. Tidak ada workflow/deploy otomatis ditambahkan.

## Hasil awal

| Data | Nilai |
|---|---:|
| Admin |defyana, ADMIN aktif bila baru |
| Karyawan unik |11 |
| Kejadian |18 DRAFT |
| Alokasi peserta |23 |
| Alokasi bernominal |20 |
| Total nominal diketahui |Rp105.000 |
| Nominal belum diketahui |3 (null) |
| Pembayaran/ledger |0 |
| Tanggal kejadian |null |
| Jenis kesalahan |belum dipilih |

Fauzi/Ahan/Zara/Dhafin/Saskia/Hakym/El/Aden/Davin/Farhan/Elvina menjadi identitas karyawan. Kapitalisasi dinormalisasi: hakym dan HAKYM satu orang; El tetap berbeda dari Elvina, Davin berbeda dari Dhafin. Bila nama bertabrakan dengan alias orang lain atau beberapa primary name, seeder berhenti dan rollback, bukan menggabungkan identitas. Identitas yang sudah ada digunakan tanpa menimpa profil/statusnya.

Nominal5k/10k/20k adalah total per kejadian, bukan per peserta. Kejadian dua orang10k dibagi5000/orang, empat orang20k dibagi5000/orang sebagai usulan draft. Kejadian carcis2 bernominal10000 untuk Dhafin. Angka2000 pada CUSTOM MILK TUMPAH2000 tetap bagian deskripsi; denda yang disebut tetap5000. Tiga kejadian terakhir tidak diasumsikan5000 atau0.

Semua kejadian DRAFT karena tanggal dan jenis belum diberikan. Source text disimpan, tidak diganti dengan tanggal hari seed. Tidak menebak kategori/tarif master baru atau membuat pembayaran. Outstanding/dashboard aktif tetap0 sampai admin meninjau alokasi, memilih tanggal/jenis yang benar, melengkapi nominal, lalu posting melalui aplikasi. Periode seed bukan tanggal kejadian. Gunakan daftar Kejadian denda dengan status Draft untuk meninjaunya.

## Eksekusi ulang dan audit

Satu transaksi meliputi admin/settings/master/case/creation marker/audit; error membatalkan semuanya. Advisory lock menserialkan seed concurrent serta berbagi namespace identitas dengan API. UUID deterministik v5 dan marker batch `catat-denda:initial-2026:v1` menandai18 kejadian secara permanen. Manifest di-hash; perubahan source batch yang telah diterapkan ditolak dan memerlukan batch baru/review eksplisit.

Seed yang diulang tidak membuat kasus/karyawan baru untuk batch lengkap, mengembalikan casesCreated0/casesSkipped18 dan mempertahankan password, nama/profil yang sudah diedit, draft yang sudah ditinjau/posted, serta pengaturan usaha. Seed bukan alat reset atau rekonsiliasi ulang data operasional. Jangan menghapus marker atau mengedit batch v1 setelah diterapkan. Case number berasal dari sequence DB, tidak dipaksa menimpa nomor yang sudah ada; transaksi gagal dapat meninggalkan gap sequence yang normal pada PostgreSQL.

Audit admin memakai ADMIN_BOOTSTRAP; data baru memakai INITIAL_DATA_SEEDED dengan aktor defyana dan metadata noncredential. Eksekusi ulang no-op tidak menambah audit berulang. Tidak ada mutation endpoint publik untuk seed.

## Bukti verifikasi

`pnpm test:seed` memakai schema PostgreSQL acak dan membersihkannya setelah selesai. Lulus: rollback tanpa password pada akun baru; rollback konflik alias tanpa partial employee/admin; dua seed concurrent menghasilkan18 kasus saja;11 identitas/23 alokasi/105000/3 null/0 ledger; source text/SAMPLE2000; source El vs Elvina/Davin vs Dhafin; password hash Argon2id; perubahan profil/pengaturan/case dipertahankan; manifest berbeda ditolak; Prisma CLI db seed no-op; login, GET/patch seeded UUID,18 draft dan saldo aktif0 melalui API compiled.

Lint, typecheck, build serta13 unit test backend lulus. Tidak ada perubahan kontrak API, frontend atau migration schema. Pada database lokal, seed dijalankan dua kali dan jumlah data tetap11 karyawan/18 draft/23 alokasi; akun defyana sebelumnya dipertahankan. Staging/produksi dijalankan kemudian memakai environment deployment sendiri.
