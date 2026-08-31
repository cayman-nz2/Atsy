// Location detection (B04) and the personal details that should not be on a
// CV at all (B08).
//
// B04 wants "city, country" and objects to a full street address. Detecting a
// country name is the reliable half; a street address is recognised by shape
// (a number followed by a thoroughfare word), because street names themselves
// are unbounded.

export const COUNTRIES = [
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina',
  'armenia', 'australia', 'austria', 'azerbaijan', 'bahamas', 'bahrain',
  'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin',
  'bhutan', 'bolivia', 'bosnia', 'botswana', 'brazil', 'brunei', 'bulgaria',
  'burkina faso', 'burundi', 'cambodia', 'cameroon', 'canada', 'chad',
  'chile', 'china', 'colombia', 'congo', 'costa rica', 'croatia', 'cuba',
  'cyprus', 'czechia', 'czech republic', 'denmark', 'djibouti', 'dominica',
  'ecuador', 'egypt', 'el salvador', 'estonia', 'eswatini', 'ethiopia',
  'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia', 'germany',
  'ghana', 'greece', 'grenada', 'guatemala', 'guinea', 'guyana', 'haiti',
  'honduras', 'hong kong', 'hungary', 'iceland', 'india', 'indonesia',
  'iran', 'iraq', 'ireland', 'israel', 'italy', 'jamaica', 'japan',
  'jordan', 'kazakhstan', 'kenya', 'kiribati', 'kosovo', 'kuwait',
  'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya',
  'liechtenstein', 'lithuania', 'luxembourg', 'madagascar', 'malawi',
  'malaysia', 'maldives', 'mali', 'malta', 'mauritania', 'mauritius',
  'mexico', 'moldova', 'monaco', 'mongolia', 'montenegro', 'morocco',
  'mozambique', 'myanmar', 'namibia', 'nepal', 'netherlands', 'new zealand',
  'nicaragua', 'niger', 'nigeria', 'north macedonia', 'norway', 'oman',
  'pakistan', 'palestine', 'panama', 'papua new guinea', 'paraguay', 'peru',
  'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia',
  'rwanda', 'samoa', 'saudi arabia', 'senegal', 'serbia', 'seychelles',
  'sierra leone', 'singapore', 'slovakia', 'slovenia', 'solomon islands',
  'somalia', 'south africa', 'south korea', 'korea', 'south sudan', 'spain',
  'sri lanka', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria',
  'taiwan', 'tajikistan', 'tanzania', 'thailand', 'togo', 'tonga',
  'trinidad', 'tunisia', 'turkey', 'turkmenistan', 'uganda', 'ukraine',
  'united arab emirates', 'uae', 'united kingdom', 'uk', 'england',
  'scotland', 'wales', 'northern ireland', 'united states', 'usa', 'u.s.',
  'america', 'uruguay', 'uzbekistan', 'vanuatu', 'venezuela', 'vietnam',
  'yemen', 'zambia', 'zimbabwe',
];

// Cities big enough that "Auckland" alone reads as a location line.
export const MAJOR_CITIES = [
  'amsterdam', 'athens', 'atlanta', 'auckland', 'austin', 'bangalore',
  'bangkok', 'barcelona', 'beijing', 'belfast', 'berlin', 'birmingham',
  'boston', 'brisbane', 'bristol', 'brussels', 'budapest', 'buenos aires',
  'cairo', 'calgary', 'cape town', 'cardiff', 'chennai', 'chicago',
  'christchurch', 'cologne', 'copenhagen', 'dallas', 'delhi', 'denver',
  'detroit', 'dubai', 'dublin', 'edinburgh', 'frankfurt', 'geneva',
  'glasgow', 'gothenburg', 'hamburg', 'helsinki', 'hobart', 'houston',
  'hyderabad', 'istanbul', 'jakarta', 'johannesburg', 'karachi', 'kuala lumpur',
  'lagos', 'leeds', 'lisbon', 'liverpool', 'london', 'los angeles', 'madrid',
  'manchester', 'manila', 'melbourne', 'mexico city', 'miami', 'milan',
  'montreal', 'moscow', 'mumbai', 'munich', 'nairobi', 'new york',
  'newcastle', 'oslo', 'ottawa', 'paris', 'perth', 'philadelphia', 'phoenix',
  'portland', 'prague', 'pune', 'reykjavik', 'riga', 'rome', 'rotterdam',
  'san diego', 'san francisco', 'santiago', 'sao paulo', 'seattle', 'seoul',
  'shanghai', 'sheffield', 'singapore', 'stockholm', 'sydney', 'taipei',
  'tallinn', 'tel aviv', 'tokyo', 'toronto', 'valencia', 'vancouver',
  'vienna', 'vilnius', 'warsaw', 'wellington', 'zagreb', 'zurich',
];

const THOROUGHFARE = [
  'street', 'st', 'road', 'rd', 'avenue', 'ave', 'lane', 'ln', 'drive', 'dr',
  'court', 'ct', 'place', 'pl', 'terrace', 'crescent', 'close', 'way',
  'boulevard', 'blvd', 'parade', 'grove', 'walk', 'row', 'square',
];

/** A house number followed by a thoroughfare word: a street address (B04). */
export function looksLikeStreetAddress(text) {
  const lower = String(text || '').toLowerCase();
  const pattern = new RegExp(`\\b\\d+[a-z]?[\\s,/-]+[a-z' -]{2,30}\\b(${THOROUGHFARE.join('|')})\\b`);
  return pattern.test(lower);
}

/** A city or country named anywhere in the text (B04). */
export function findPlace(text) {
  const lower = ` ${String(text || '').toLowerCase().replace(/[^a-z. ]/g, ' ').replace(/\s+/g, ' ')} `;
  for (const list of [MAJOR_CITIES, COUNTRIES]) {
    for (const place of list) {
      if (lower.includes(` ${place} `)) return place;
    }
  }
  return null;
}

// Details that invite bias and that no employer in Atsy's markets needs (B08).
// Each is a label the CV itself uses, so matching the label avoids guessing at
// values — a bare date is a date of employment far more often than a birthday.
export const PERSONAL_DETAIL_PATTERNS = [
  { label: 'date of birth', pattern: /\b(date of birth|d\.?o\.?b\.?|birth ?date|born on)\b/i },
  { label: 'marital status', pattern: /\b(marital status|married|single|divorced|widowed)\b(?!\s*(handed|malt))/i },
  { label: 'gender', pattern: /\b(gender|sex)\s*[:\-]/i },
  { label: 'nationality', pattern: /\b(nationality|citizenship)\s*[:\-]/i },
  { label: 'national identity number', pattern: /\b(national insurance|ssn|social security|nhs number|ird number|passport no)\b/i },
  { label: 'religion', pattern: /\breligion\s*[:\-]/i },
  { label: 'a photograph reference', pattern: /\b(photo attached|photograph attached)\b/i },
];

export function findPersonalDetails(text) {
  return PERSONAL_DETAIL_PATTERNS
    .filter(({ pattern }) => pattern.test(String(text || '')))
    .map(({ label }) => label);
}
