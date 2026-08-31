// The golden corpus. Each fixture isolates one defect a real CV has, so every
// check in docs/SCORING-SPEC.md can be proved to fire on a document that has
// the problem and stay quiet on one that does not.
//
// `clean` is the control: single column, canonical headings, one date format,
// quantified bullets, contact in the body.

import { writePdf, column } from './pdf-writer.js';

const A4 = { width: 595, height: 842 };
// Word and Google Docs both write /Lang. A corpus where no fixture declares a
// language makes P17 fire on every CV, which tells the reader nothing.
const DOC_INFO = { lang: 'en-NZ' };
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
    info: DOC_INFO,
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
    return writePdf({ info: DOC_INFO, pages: [{ ...A4, runs }] });
  },

  // Contact details in the top band, repeated on both pages: the region most
  // parsers skip.
  headerContact: () => {
    const bandRun = (page) => ({
      text: 'priya.raman@example.com | +64 21 555 0134',
      x: 57, y: A4.height - 24, size: 9,
    });
    return writePdf({
      info: DOC_INFO,
      pages: [
        { ...A4, runs: [bandRun(1), ...column({ x: 57, top: 90, lines: CLEAN_LINES.slice(0, 20).filter((l) => !l.includes('@')), pageHeight: A4.height })] },
        { ...A4, runs: [bandRun(2), ...column({ x: 57, top: 90, lines: CLEAN_LINES.slice(20), pageHeight: A4.height })] },
      ],
    });
  },

  // A scan: pixels, no text layer at all.
  imageOnly: () => writePdf({
    info: DOC_INFO,
    pages: [{ ...A4, runs: [], images: [{ x: 40, y: 40, w: 515, h: 760 }] }],
  }),

  // Keyword stuffing: a block drawn in invisible render mode, plus a line in
  // white on the white page.
  hiddenText: () => writePdf({
    info: DOC_INFO,
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
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
      images: [{ x: 430, y: 700, w: 110, h: 130 }],
    }],
  }),

  // Four pages of the same content: longer than anyone reads.
  fourPage: () => writePdf({
    info: DOC_INFO,
    pages: [1, 2, 3, 4].map(() => ({
      ...A4, runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
    })),
  }),

  // Headings a parser's section model does not recognise.
  oddHeadings: () => writePdf({
    info: DOC_INFO,
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
    info: DOC_INFO,
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
    info: DOC_INFO,
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
    return writePdf({ info: DOC_INFO, pages: [{ ...A4, runs }] });
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
    return writePdf({ info: DOC_INFO, pages: [{ ...A4, runs }] });
  },

  // No way to reach the candidate. Every other CV in the corpus has contact
  // details somewhere; this one has a name and nothing else, which is a
  // rejection at the first screen no matter how good the rest is.
  noContact: () => writePdf({
    info: DOC_INFO,
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
    info: DOC_INFO,
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
      info: DOC_INFO,
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
    info: DOC_INFO,
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
    return writePdf({ info: DOC_INFO, pages: [{ ...A4, runs: column({ x: 57, top: 60, lines, pageHeight: A4.height }) }] });
  },

  // Nineteen months between the two roles. Not a defect in itself — the point
  // is that Atsy can see it, so it can say so before a recruiter does.
  careerGap: () => writePdf({
    info: DOC_INFO,
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
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({ x: 57, top: 60, lines: CLEAN_LINES, size: 7, leading: 10, pageHeight: A4.height }),
    }],
  }),

  // No declared /Lang. Every other fixture declares en-NZ, the way a real
  // export does, so this is the only one that triggers P17 — and it does so on
  // the language half alone. The mixed-script half is exercised as a direct
  // check test: a second script needs a font that can encode it, and the
  // fixture writer only has the standard 14.
  noLanguage: () => writePdf({
    pages: [{
      ...A4,
      runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
    }],
  }),

  // One bullet that runs to a paragraph, WRAPPED the way a real editor wraps
  // it: continuation lines start lower-case at the same indent. Written
  // unwrapped, the line ran off the page and pdf.js discarded the overflow, so
  // the fixture silently tested nothing (incident 60).
  wallOfText: () => {
    const wrapped = [
      'Was responsible for a broad portfolio of operational duties spanning',
      'the depot network, including delivery performance oversight and the',
      'coordination of dispatch teams, as well as weekly reporting to the',
      'senior leadership group on progress against the agreed targets.',
    ];
    const lines = CLEAN_LINES.flatMap((line) =>
      (line.startsWith('Lifted on-time') ? wrapped : [line]));
    return writePdf({
      info: DOC_INFO,
      pages: [{ ...A4, runs: column({ x: 57, top: 60, lines, pageHeight: A4.height }) }],
    });
  },

  // Skills as rating bars: five filled rectangles and no text. The reader sees
  // "advanced SQL"; the parser sees an empty skills section.
  skillBars: () => {
    const lines = CLEAN_LINES.slice(0, CLEAN_LINES.indexOf('SKILLS') + 1);
    const runs = column({ x: 57, top: 60, lines, pageHeight: A4.height });
    // The bars go directly under the SKILLS heading, where a real CV draws
    // them. Placed at the foot of the page instead they are 350pt away from
    // the heading and no proximity test could reasonably connect the two.
    const headingY = A4.height - 60 - (lines.length - 1) * 15;
    const rects = [0, 1, 2, 3, 4].map((row) => ({
      x: 57, y: headingY - 22 - row * 18, w: 60 + row * 30, h: 8, rgb: [0.15, 0.15, 0.15],
    }));
    return writePdf({ info: DOC_INFO, pages: [{ ...A4, runs, rects }] });
  },

  // --- one fixture per remaining check ------------------------------------
  // The spec's rule is that no check ships without a fixture that fires it and
  // one that does not. `clean` is the "does not" for all of these.

  // B01: the CV opens straight into contact details with no name line at all.
  // Dropping only the name is not enough — the job title on the next line
  // reads as a name to any heuristic, and to a human skimming.
  noName: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: ['CURRICULUM VITAE 2026', ...CLEAN_LINES.slice(2)],
      }),
    }],
  }),

  // B08: personal details that invite bias and help nobody.
  personalDetails: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: [
          CLEAN_LINES[0],
          'Date of Birth: 4 May 1988 | Marital status: married | Nationality: NZ',
          ...CLEAN_LINES.slice(1),
        ],
      }),
    }],
  }),

  // C05: the newest role has a closed end date, so a parser files the reader
  // as unemployed. C06 rides along on the reversed pair below instead.
  noPresentMarker: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) =>
          (line === 'Mar 2023 - Present' ? 'Mar 2023 - Dec 2025' : line)),
      }),
    }],
  }),

  // C06: an end date before its start date.
  impossibleDates: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) =>
          (line === 'Jun 2019 - Feb 2023' ? 'Feb 2023 - Jun 2019' : line)),
      }),
    }],
  }),

  // C07: a title no search will ever return.
  weakTitle: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) =>
          (line === 'Operations Manager, Kauri Logistics' ? 'Operations Ninja, Kauri Logistics' : line)),
      }),
    }],
  }),

  // D08: five verb-initial bullets, two of them present tense inside roles
  // that ended years ago. Tense is only judgeable from bullets that actually
  // open with a recognised verb, so these deliberately do.
  mixedTense: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) => {
          if (line.startsWith('Lifted on-time')) return 'Lift on-time delivery from 82% to 96% across 14 depots in 9 months.';
          if (line.startsWith('Cut dispatch')) return 'Manage the pick-and-pack process, cutting dispatch errors by 41%.';
          return line;
        }),
      }),
    }],
  }),

  // D05: first-person pronouns throughout.
  pronouns: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) => {
          if (line.startsWith('Lifted on-time')) return 'I lift on-time delivery from 82% to 96% across 14 depots.';
          if (line.startsWith('Cut dispatch')) return 'I manage the pick-and-pack process, cutting errors by 41%.';
          if (line.startsWith('Led a team')) return 'Lead a team of 24 and reduce staff turnover from 30% to 11%.';
          if (line.startsWith('Managed rosters')) return 'Managed rosters for 24 staff across 3 sites, saving $180k a year.';
          return line;
        }),
      }),
    }],
  }),

  // E02 and E05: skills laid out as a grid, with self-rated levels in the text.
  skillsGrid: () => {
    const head = CLEAN_LINES.slice(0, CLEAN_LINES.indexOf('SKILLS') + 1);
    const runs = column({ x: 57, top: 60, lines: head, pageHeight: A4.height });
    const gridTop = A4.height - 60 - head.length * 15;
    const rows = [
      ['SQL', 'Expert: 9/10', 'Power BI'],
      ['Lean', 'Advanced', 'ERP migration'],
      ['Process design', 'Expert', 'Negotiation'],
      ['Forecasting', 'Intermediate', 'Reporting'],
    ];
    rows.forEach((cells, rowIndex) => {
      const y = gridTop - rowIndex * 20;
      cells.forEach((cell, cellIndex) => {
        runs.push({ text: cell, x: 57 + cellIndex * 170, y, size: 10 });
      });
    });
    return writePdf({ info: DOC_INFO, pages: [{ ...A4, runs }] });
  },

  // P06: a font that is neither embedded nor one of the standard 14.
  exoticFont: () => writePdf({
    info: DOC_INFO,
    font: 'BrandonGrotesque-Medium',
    pages: [{
      ...A4,
      runs: column({ x: 57, top: 60, lines: CLEAN_LINES, pageHeight: A4.height }),
    }],
  }),

  // P15: the portfolio URL exists only as a link annotation behind the word
  // "here", so the text a parser reads contains no URL at all.
  annotationOnlyLink: () => writePdf({
    info: DOC_INFO,
    pages: [{
      ...A4,
      runs: column({
        x: 57, top: 60, pageHeight: A4.height,
        lines: CLEAN_LINES.map((line) =>
          (line === 'linkedin.com/in/priyaraman' ? 'Portfolio: available here' : line)),
      }),
      links: [{ url: 'https://priyaraman.example.com/portfolio', rect: [120, 770, 200, 784] }],
    }],
  }),
};

const cache = new Map();

/** Build (and memoise) one fixture as PDF bytes. */
export function fixture(name) {
  if (!FIXTURES[name]) throw new Error(`unknown fixture: ${name}`);
  if (!cache.has(name)) cache.set(name, FIXTURES[name]());
  return cache.get(name);
}

export const fixtureNames = Object.keys(FIXTURES);
