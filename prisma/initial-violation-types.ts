export const initialViolationTypes = [
  {
    code: 'CATAT-STOK',
    name: 'Kesalahan pencatatan stok',
    category: 'INVENTORY_LOG',
    defaultAmountPerPerson: 5000,
    requiresReview: false,
    description:
      'Kesalahan pencatatan stok, termasuk menulis SO pada buku report beans.',
  },
  {
    code: 'BUANG-SAMPAH',
    name: 'Tidak membuang sampah',
    category: 'CLEANLINESS',
    defaultAmountPerPerson: 5000,
    requiresReview: false,
    description:
      'Tidak membuang sampah atau meninggalkan sampah yang menjadi tanggung jawab karyawan.',
  },
  {
    code: 'TUMPAH',
    name: 'Menumpahkan minuman atau bahan',
    category: 'SPILL',
    defaultAmountPerPerson: 5000,
    requiresReview: false,
    description:
      'Menumpahkan minuman atau bahan, termasuk matcha, machiato, custom milk, dan cream latte.',
  },
  {
    code: 'SALAH-RACIK',
    name: 'Kesalahan bahan atau racikan minuman',
    category: 'PREPARATION',
    defaultAmountPerPerson: 5000,
    requiresReview: false,
    description:
      'Penggunaan bahan, sirup, kopi, atau base yang tidak sesuai racikan minuman.',
  },
  {
    code: 'SALAH-PESANAN',
    name: 'Kesalahan pembuatan pesanan',
    category: 'ORDER',
    defaultAmountPerPerson: 10000,
    requiresReview: true,
    description:
      'Usulan dari catatan carcis 2 harusnya machiato. Tarif mengikuti nominal sumber10000 untuk satu orang. Nonaktif sampai makna kejadian dan tarif disetujui pengelola.',
  },
  {
    code: 'PERLU-KLASIFIKASI',
    name: 'Perlu klasifikasi',
    category: 'OTHER',
    defaultAmountPerPerson: 5000,
    requiresReview: true,
    description:
      'Penampung sementara catatan matcha yakult dan custom milk1L yang belum menjelaskan bentuk kesalahan. Tarif5000 mengikuti nominal kedua sumber. Wajib diganti atau ditinjau sebelum posting; tidak untuk kejadian baru.',
  },
] as const;

export type InitialViolationCode =
  (typeof initialViolationTypes)[number]['code'];

// Separate from the immutable source manifest so existing seed batches can be upgraded.
export const initialIncidentTypes = [
  'PERLU-KLASIFIKASI',
  'CATAT-STOK',
  'CATAT-STOK',
  'BUANG-SAMPAH',
  'TUMPAH',
  'BUANG-SAMPAH',
  'SALAH-PESANAN',
  'TUMPAH',
  'BUANG-SAMPAH',
  'SALAH-RACIK',
  'TUMPAH',
  'SALAH-RACIK',
  'SALAH-RACIK',
  'TUMPAH',
  'PERLU-KLASIFIKASI',
  'SALAH-RACIK',
  'SALAH-RACIK',
  'SALAH-RACIK',
] as const satisfies readonly InitialViolationCode[];
