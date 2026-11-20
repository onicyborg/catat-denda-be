export const initialEmployees = [
  'Fauzi',
  'Ahan',
  'Zara',
  'Dhafin',
  'Saskia',
  'Hakym',
  'El',
  'Aden',
  'Davin',
  'Farhan',
  'Elvina',
] as const;
export type InitialEmployee = (typeof initialEmployees)[number];
type Incident = {
  sourceText: string;
  description: string;
  employees: InitialEmployee[];
  total: number | null;
};

// Totals belong to the whole incident. Shared allocations remain draft proposals.
export const initialIncidents: Incident[] = [
  {
    sourceText: 'fauzi (matcha yakult) 5k',
    description: 'matcha yakult',
    employees: ['Fauzi'],
    total: 5000,
  },
  {
    sourceText: 'ahan (nulis so di buku report beans) 5k',
    description: 'nulis so di buku report beans',
    employees: ['Ahan'],
    total: 5000,
  },
  {
    sourceText: 'zara & dhafin (nulis so di buku report beans) 10k',
    description: 'nulis so di buku report beans',
    employees: ['Zara', 'Dhafin'],
    total: 10000,
  },
  {
    sourceText: 'saskia & zara (ga buang sampah) 10k',
    description: 'ga buang sampah',
    employees: ['Saskia', 'Zara'],
    total: 10000,
  },
  {
    sourceText: 'dhafin (matcha tumpah) 5k',
    description: 'matcha tumpah',
    employees: ['Dhafin'],
    total: 5000,
  },
  {
    sourceText: 'hakym (sampah ga dibuang) 5k',
    description: 'sampah ga dibuang',
    employees: ['Hakym'],
    total: 5000,
  },
  {
    sourceText: 'dhafin (carcis 2 harusnya machiato) 10k',
    description: 'carcis 2 harusnya machiato',
    employees: ['Dhafin'],
    total: 10000,
  },
  {
    sourceText: 'dhafin (machiato tumpah) 5k',
    description: 'machiato tumpah',
    employees: ['Dhafin'],
    total: 5000,
  },
  {
    sourceText: 'fauzi, el, zara, aden (gabuang sampah) 20k',
    description: 'gabuang sampah',
    employees: ['Fauzi', 'El', 'Zara', 'Aden'],
    total: 20000,
  },
  {
    sourceText: 'ahan (red velvet pake butterscotch) 5k',
    description: 'red velvet pake butterscotch',
    employees: ['Ahan'],
    total: 5000,
  },
  {
    sourceText: 'HAKYM (CUSTOM MILK TUMPAH 2000) 5K',
    description: 'CUSTOM MILK TUMPAH 2000',
    employees: ['Hakym'],
    total: 5000,
  },
  {
    sourceText: '\u2060DAVIN MOGITO PAKE KOPI 5K',
    description: 'MOGITO PAKE KOPI',
    employees: ['Davin'],
    total: 5000,
  },
  {
    sourceText: '\u2060DAVIN TROPICAL BLITZ PKE SYIRUP MANGGA 5K',
    description: 'TROPICAL BLITZ PKE SYIRUP MANGGA',
    employees: ['Davin'],
    total: 5000,
  },
  {
    sourceText: 'FARHAN NUMPAHIN CREAMT LATTE 5K',
    description: 'NUMPAHIN CREAMT LATTE',
    employees: ['Farhan'],
    total: 5000,
  },
  {
    sourceText: 'FARHAN CUSTOME MILK 1L 5K',
    description: 'CUSTOME MILK 1L',
    employees: ['Farhan'],
    total: 5000,
  },
  {
    sourceText: 'FAUZI, KOPI JADI COKLAAT',
    description: 'KOPI JADI COKLAAT',
    employees: ['Fauzi'],
    total: null,
  },
  {
    sourceText: 'ELVINA LATTE PAKE ROBUS',
    description: 'LATTE PAKE ROBUS',
    employees: ['Elvina'],
    total: null,
  },
  {
    sourceText: 'HAKYM MATCHA PAKE BASE CREAMY',
    description: 'MATCHA PAKE BASE CREAMY',
    employees: ['Hakym'],
    total: null,
  },
];
