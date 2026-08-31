// The golden corpus. Each fixture isolates one defect a real CV has, so every
// check in docs/SCORING-SPEC.md can be proved to fire on a document that has
// the problem and stay quiet on one that does not.
//
// `clean` is the control: single column, canonical headings, one date format,
// quantified bullets, contact in the body.

import { writePdf, column } from './pdf-writer.js';

const A4 = { width: 595, height: 842 };
const CLEAN_LINES = [
  'Priya Raman',
  'Operations Manager',
  'priya.raman@example.com | +64 21 555 0134 | Auckland, New Zealand',
  'linkedin.com/in/priyaraman',
  '',
  'SUMMARY',
  'Operations manager with 8 years in freight and warehousing, leading teams of up to 24.',
  '',
  'EXPERIENCE',
  'Operations Manager, Kauri Logistics',
  'Mar 2023 - Present',
  'Lifted on-time delivery from 82% to 96% across 14 depots in 9 months.',
  'Cut dispatch errors by 41% by rebuilding the pick-and-pack process.',
  'Led a team of 24 and reduced staff turnover from 30% to 11%.',
  '',
  'Team Lead, Southbound Freight',
  'Jun 2019 - Feb 2023',
  'Managed rosters for 24 staff across 3 sites, saving $180k a year in overtime.',
  'Negotiated 12 supplier contracts, cutting freight cost per unit by 18%.',
  '',
  'EDUCATION',
  'Bachelor of Commerce, University of Auckland, 2014',
  '',
  'SKILLS',
  'Process design, SQL, Power BI, Lean, ERP migration, contract negotiation',
];

export const FIXTURES = {
  // The control: everything a parser wants.
  clean: () => writePdf({
    pages: [{ ...A4, runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }) }],
  }),

  // Two columns with a clear gutter. The runs are emitted the way a real
  // export orders them — across the gutter, line by line — which is exactly
  // why extraction interleaves them.
  twoColumn: () => {
    const left = ['SKILLS', 'Process design', 'SQL', 'Stakeholders', '', 'EDUCATION',
      'BCom, Auckland', '2014', '', 'LANGUAGES', 'English, Tamil'];
    const right = ['EXPERIENCE', 'Operations Manager, Kauri Logistics', 'Mar 2023 - Present',
      'Ran the warehouse team and daily dispatch', 'Improved on-time delivery', '',
      'Team Lead, Southbound Freight', 'Jun 2019 - Feb 2023', 'Managed rosters for 24 staff',
      'Managed supplier relationships'];
    const runs = [
      ...column({ x: 57, top: 60, lines: ['Priya Raman', 'Operations Manager'], size: 16, pageHeight: A4.height }),
    ];
    const rows = Math.max(left.length, right.length);
    for (let row = 0; row < rows; row += 1) {
      const y = A4.height - 120 - row * 16;
      if (left[row]) runs.push({ text: left[row], x: 57, y, size: 10 });
      if (right[row]) runs.push({ text: right[row], x: 250, y, size: 10 });
    }
    return writePdf({ pages: [{ ...A4, runs }] });
  },

  // Contact details in the top band, repeated on both pages: the region most
  // parsers skip.
  headerContact: () => {
    const bandRun = (page) => ({
      text: 'priya.raman@example.com | +64 21 555 0134',
      x: 57, y: A4.height - 24, size: 9,
    });
    return writePdf({
      pages: [
        { ...A4, runs: [bandRun(1), ...column({ x: 57, top: 90, lines: CLEAN_LINES.slice(0, 20).filter((l) => !l.includes('@')), pageHeight: A4.height })] },
        { ...A4, runs: [bandRun(2), ...column({ x: 57, top: 90, lines: CLEAN_LINES.slice(20), pageHeight: A4.height })] },
      ],
    });
  },

  // A scan: pixels, no text layer at all.
  imageOnly: () => writePdf({
    pages: [{ ...A4, runs: [], images: [{ x: 40, y: 40, w: 515, h: 760 }] }],
  }),

  // Keyword stuffing: a block drawn in invisible render mode, plus a line in
  // white on the white page.
  hiddenText: () => writePdf({
    pages: [{
      ...A4,
      runs: [
        ...column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
        { text: 'project manager scrum agile pmp six sigma stakeholder', x: 57, y: 60, size: 8, mode: 3 },
        { text: 'python java kubernetes terraform', x: 57, y: 48, size: 8, rgb: [1, 1, 1] },
      ],
    }],
  }),

  // A photo in the top third of the first page.
  withPhoto: () => writePdf({
    pages: [{
      ...A4,
      runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
      images: [{ x: 430, y: 700, w: 110, h: 130 }],
    }],
  }),

  // Four pages of the same content: longer than anyone reads.
  fourPage: () => writePdf({
    pages: [1, 2, 3, 4].map(() => ({
      ...A4, runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
    })),
  }),

  // Headings a parser's section model does not recognise.
  oddHeadings: () => writePdf({
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) => {
          if (line === 'EXPERIENCE') return 'MY JOURNEY';
          if (line === 'SUMMARY') return 'WHO I AM';
          if (line === 'SKILLS') return 'WHAT I BRING';
          return line;
        }),
      }),
    }],
  }),

  // Two date families in one document.
  dateChaos: () => writePdf({
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) => {
          if (line === 'Mar 2023 - Present') return 'March 2023 - now';
          if (line === 'Jun 2019 - Feb 2023') return '06/2019 - 02/2023';
          return line;
        }),
      }),
    }],
  }),

  // Every bullet is a duty, not a result.
  noMetrics: () => writePdf({
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) => {
          if (line.startsWith('Lifted on-time')) return 'Responsible for on-time delivery across the depots';
          if (line.startsWith('Cut dispatch')) return 'Responsible for the pick-and-pack process';
          if (line.startsWith('Led a team')) return 'Duties included managing the team and the roster';
          if (line.startsWith('Managed rosters')) return 'Managed rosters and staff across the sites';
          if (line.startsWith('Negotiated')) return 'Managed supplier relationships and contracts';
          return line;
        }),
      }),
    }],
  }),

  // The other two-column shape: each column is its own text frame, so the
  // whole sidebar is stored before the main column. The page looks identical
  // and the stored order is nothing like the reading order.
  twoColumnFrames: () => {
    const runs = column({ x: 57, top: 60, lines: ['Priya Raman', 'Operations Manager'], size: 16, pageHeight: A4.height });
    runs.push(...column({
      x: 57, top: 120, size: 10, leading: 16, pageHeight: A4.height,
      lines: ['SKILLS', 'Process design', 'SQL', 'Stakeholders', '', 'EDUCATION',
        'BCom, Auckland', '2014', '', 'LANGUAGES', 'English, Tamil'],
    }));
    runs.push(...column({
      x: 250, top: 120, size: 10, leading: 16, pageHeight: A4.height,
      lines: ['EXPERIENCE', 'Operations Manager, Kauri Logistics', 'Mar 2023 - Present',
        'Ran the warehouse team and daily dispatch', 'Improved on-time delivery', '',
        'Team Lead, Southbound Freight', 'Jun 2019 - Feb 2023', 'Managed rosters for 24 staff',
        'Managed supplier relationships'],
    }));
    return writePdf({ pages: [{ ...A4, runs }] });
  },

  // A table: three or more rows whose cells share x positions.
  tableLayout: () => {
    const runs = column({ x: 57, top: 60, lines: ['Priya Raman', 'EXPERIENCE'], pageHeight: A4.height });
    const rows = [
      ['Operations Manager', 'Kauri Logistics', 'Mar 2023 - Present'],
      ['Team Lead', 'Southbound Freight', 'Jun 2019 - Feb 2023'],
      ['Coordinator', 'Harbour Freight', 'Jan 2017 - May 2019'],
      ['Assistant', 'Port Services', 'Feb 2015 - Dec 2016'],
    ];
    rows.forEach((cells, rowIndex) => {
      const y = A4.height - 140 - rowIndex * 22;
      cells.forEach((cell, cellIndex) => {
        runs.push({ text: cell, x: 57 + cellIndex * 170, y, size: 10 });
      });
    });
    return writePdf({ pages: [{ ...A4, runs }] });
  },

  // No way to reach the candidate. Every other CV in the corpus has contact
  // details somewhere; this one has a name and nothing else, which is a
  // rejection at the first screen no matter how good the rest is.
  noContact: () => writePdf({
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.filter((line) => !line.includes('@') && !line.includes('linkedin')),
      }),
    }],
  }),

  // Contact details in the bottom band. Visually fine, and in the region a
  // parser is most likely to treat as a running foot and discard.
  footerContact: () => writePdf({
    pages: [{
      ...A4,
      runs: [
        ...column({
          x: 57, top: 60, pageHeight: A4.height,
          lines: CLEAN_LINES.filter((line) => !line.includes('@') && !line.includes('linkedin')),
        }),
        { text: 'priya.raman@example.com | +64 21 555 0134', x: 57, y: 22, size: 9 },
      ],
    }],
  }),

  // A running head and foot on all three pages: the pattern a parser detects
  // and strips, taking whatever was put there with it.
  runningHeadFoot: () => {
    const chunk = (start) => CLEAN_LINES.slice(start, start + 12);
    return writePdf({
      pages: [0, 12, 24].map((start) => ({
        ...A4,
        runs: [
          { text: 'Priya Raman - Curriculum Vitae', x: 57, y: A4.height - 22, size: 9 },
          ...column({ x: 57, top: 90, lines: chunk(start), pageHeight: A4.height }),
          { text: 'Confidential - page of 3', x: 57, y: 22, size: 9 },
        ],
      })),
    });
  },

  // No headings at all: one continuous block. A human can read it; a parser
  // has nothing to hang a section model on, so nothing is found where it is
  // expected to be.
  noSections: () => writePdf({
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.filter((line) => line && line !== line.toUpperCase()),
      }),
    }],
  }),

  // Chronological rather than reverse-chronological: the oldest role first.
  // Every screen a recruiter runs assumes the opposite.
  oldestFirst: () => {
    const lines = [
      ...CLEAN_LINES.slice(0, CLEAN_LINES.indexOf('EXPERIENCE') + 1),
      'Team Lead, Southbound Freight',
      'Jun 2019 - Feb 2023',
      'Managed rosters for 24 staff across 3 sites, saving $180k a year in overtime.',
      'Negotiated 12 supplier contracts, cutting freight cost per unit by 18%.',
      '',
      'Operations Manager, Kauri Logistics',
      'Mar 2023 - Present',
      'Lifted on-time delivery from 82% to 96% across 14 depots in 9 months.',
      'Cut dispatch errors by 41% by rebuilding the pick-and-pack process.',
      '',
      ...CLEAN_LINES.slice(CLEAN_LINES.indexOf('EDUCATION')),
    ];
    return writePdf({ pages: [{ ...A4, runs: column({ x: 57, top: 60, lines, pageHeight: A4.height }) }] });
  },

  // Nineteen months between the two roles. Not a defect in itself — the point
  // is that Atsy can see it, so it can say so before a recruiter does.
  careerGap: () => writePdf({
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) =>
          (line === 'Jun 2019 - Feb 2023' ? 'Jun 2017 - Aug 2021' : line)),
      }),
    }],
  }),

  // Seven-point body text: squeezed onto one page at the cost of being
  // unreadable on a phone, which is where most first screens now happen.
  tinyType: () => writePdf({
    pages: [{
      ...A4,
      runs: column({ x: 57, top: 60, lines: CLEAN_LINES, size: 7, leading: 10, pageHeight: A4.height }),
    }],
  }),

  // Skills as rating bars: five filled rectangles and no text. The reader sees
  // "advanced SQL"; the parser sees an empty skills section.
  skillBars: () => {
    const lines = CLEAN_LINES.slice(0, CLEAN_LINES.indexOf('SKILLS') + 1);
    const runs = column({ x: 57, top: 60, lines, pageHeight: A4.height });
    const rects = [0, 1, 2, 3, 4].map((row) => ({
      x: 57, y: 150 - row * 18, w: 60 + row * 30, h: 8, rgb: [0.15, 0.15, 0.15],
    }));
    return writePdf({ pages: [{ ...A4, runs, rects }] });
  },
};

const cache = new Map();

/** Build (and memoise) one fixture as PDF bytes. */
export function fixture(name) {
  if (!FIXTURES[name]) throw new Error(`unknown fixture: ${name}`);
  if (!cache.has(name)) cache.set(name, FIXTURES[name]());
  return cache.get(name);
}

export const fixtureNames = Object.keys(FIXTURES);
