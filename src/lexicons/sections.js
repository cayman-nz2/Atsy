// Canonical section headings, and the labels real CVs use for them.
// A parser's sectioning stage matches against a list like this one; a heading
// that is not on it means the section under it is never attributed.

export const SECTION_SYNONYMS = {
  summary: ['summary', 'professional summary', 'profile', 'personal profile', 'about me',
    'about', 'objective', 'career objective', 'executive summary', 'personal statement'],
  experience: ['experience', 'work experience', 'professional experience', 'employment',
    'employment history', 'work history', 'career history', 'relevant experience',
    'professional background'],
  education: ['education', 'academic background', 'qualifications', 'education and training',
    'academic qualifications'],
  skills: ['skills', 'technical skills', 'core skills', 'key skills', 'core competencies',
    'technical proficiencies', 'areas of expertise'],
  certifications: ['certifications', 'certificates', 'licences', 'licenses', 'accreditations',
    'professional certifications'],
  projects: ['projects', 'selected projects', 'personal projects', 'key projects'],
  publications: ['publications', 'papers', 'research'],
  awards: ['awards', 'honours', 'honors', 'achievements'],
  volunteering: ['volunteering', 'volunteer experience', 'community', 'community involvement'],
  languages: ['languages'],
  interests: ['interests', 'hobbies', 'interests and hobbies'],
  references: ['references', 'referees'],
  development: ['professional development', 'training', 'courses'],
};

// Sections a CV is expected to have. Their absence is a finding.
export const REQUIRED_SECTIONS = ['experience', 'education', 'skills'];

const LOOKUP = new Map();
for (const [canonical, labels] of Object.entries(SECTION_SYNONYMS)) {
  for (const label of labels) LOOKUP.set(label, canonical);
}

export const normalise = (text) => text
  .toLowerCase()
  .replace(/&/g, ' and ')       // "Education & Training" is the same heading
  .replace(/[^a-z\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Levenshtein distance, capped: we only care whether it is 0, 1, or more.
function withinOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** The canonical section a heading label refers to, or null. */
export function canonicalSection(label) {
  const text = normalise(label);
  if (!text) return null;
  const exact = LOOKUP.get(text);
  if (exact) return exact;
  // One typo is still the same heading: "Experiance" is not a creative choice.
  if (text.length >= 6) {
    for (const [known, canonical] of LOOKUP) {
      if (known.length >= 6 && withinOne(text, known)) return canonical;
    }
  }
  return null;
}
