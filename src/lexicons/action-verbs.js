// Action verbs a CV bullet should open with (D02), plus the machinery for
// D07 (one verb used to death) and D08 (tense drift).
//
// Stored as past-tense forms with their present-tense partner, because a CV
// mixes both legitimately: past roles in past tense, the current role in
// present. Knowing which form a bullet used is what makes D08 possible.

export const ACTION_VERBS = [
  ['achieved', 'achieve'], ['accelerated', 'accelerate'], ['acquired', 'acquire'],
  ['adapted', 'adapt'], ['administered', 'administer'], ['advised', 'advise'],
  ['advocated', 'advocate'], ['aligned', 'align'], ['analysed', 'analyse'],
  ['analyzed', 'analyze'], ['answered', 'answer'], ['anticipated', 'anticipate'],
  ['applied', 'apply'], ['appointed', 'appoint'], ['approved', 'approve'],
  ['arranged', 'arrange'], ['assembled', 'assemble'], ['assessed', 'assess'],
  ['assigned', 'assign'], ['audited', 'audit'], ['authored', 'author'],
  ['automated', 'automate'], ['balanced', 'balance'], ['benchmarked', 'benchmark'],
  ['brokered', 'broker'], ['budgeted', 'budget'], ['built', 'build'],
  ['calculated', 'calculate'], ['campaigned', 'campaign'], ['captured', 'capture'],
  ['centralised', 'centralise'], ['certified', 'certify'], ['chaired', 'chair'],
  ['championed', 'champion'], ['clarified', 'clarify'], ['closed', 'close'],
  ['coached', 'coach'], ['collaborated', 'collaborate'], ['collected', 'collect'],
  ['commissioned', 'commission'], ['communicated', 'communicate'], ['compiled', 'compile'],
  ['completed', 'complete'], ['composed', 'compose'], ['computed', 'compute'],
  ['conceived', 'conceive'], ['conducted', 'conduct'], ['configured', 'configure'],
  ['consolidated', 'consolidate'], ['constructed', 'construct'], ['consulted', 'consult'],
  ['contributed', 'contribute'], ['converted', 'convert'], ['coordinated', 'coordinate'],
  ['created', 'create'], ['cultivated', 'cultivate'], ['curated', 'curate'],
  ['cut', 'cut'], ['debugged', 'debug'], ['decreased', 'decrease'],
  ['defined', 'define'], ['delivered', 'deliver'], ['demonstrated', 'demonstrate'],
  ['deployed', 'deploy'], ['designed', 'design'], ['detected', 'detect'],
  ['determined', 'determine'], ['developed', 'develop'], ['devised', 'devise'],
  ['diagnosed', 'diagnose'], ['directed', 'direct'], ['discovered', 'discover'],
  ['documented', 'document'], ['doubled', 'double'], ['drafted', 'draft'],
  ['drove', 'drive'], ['earned', 'earn'], ['edited', 'edit'],
  ['educated', 'educate'], ['eliminated', 'eliminate'], ['embedded', 'embed'],
  ['enabled', 'enable'], ['engineered', 'engineer'], ['enhanced', 'enhance'],
  ['ensured', 'ensure'], ['established', 'establish'], ['estimated', 'estimate'],
  ['evaluated', 'evaluate'], ['examined', 'examine'], ['executed', 'execute'],
  ['expanded', 'expand'], ['expedited', 'expedite'], ['explained', 'explain'],
  ['facilitated', 'facilitate'], ['finalised', 'finalise'], ['financed', 'finance'],
  ['forecast', 'forecast'], ['formalised', 'formalise'], ['formed', 'form'],
  ['founded', 'found'], ['generated', 'generate'], ['governed', 'govern'],
  ['grew', 'grow'], ['guided', 'guide'], ['halved', 'halve'],
  ['handled', 'handle'], ['headed', 'head'], ['hired', 'hire'],
  ['identified', 'identify'], ['implemented', 'implement'], ['improved', 'improve'],
  ['increased', 'increase'], ['influenced', 'influence'], ['informed', 'inform'],
  ['initiated', 'initiate'], ['innovated', 'innovate'], ['inspected', 'inspect'],
  ['installed', 'install'], ['instituted', 'institute'], ['integrated', 'integrate'],
  ['interpreted', 'interpret'], ['interviewed', 'interview'], ['introduced', 'introduce'],
  ['invented', 'invent'], ['investigated', 'investigate'], ['launched', 'launch'],
  ['led', 'lead'], ['leveraged', 'leverage'], ['lifted', 'lift'],
  ['maintained', 'maintain'], ['managed', 'manage'], ['mapped', 'map'],
  ['marketed', 'market'], ['measured', 'measure'], ['mediated', 'mediate'],
  ['mentored', 'mentor'], ['merged', 'merge'], ['migrated', 'migrate'],
  ['minimised', 'minimise'], ['modelled', 'model'], ['modernised', 'modernise'],
  ['monitored', 'monitor'], ['motivated', 'motivate'], ['negotiated', 'negotiate'],
  ['onboarded', 'onboard'], ['operated', 'operate'], ['optimised', 'optimise'],
  ['orchestrated', 'orchestrate'], ['organised', 'organise'], ['originated', 'originate'],
  ['overhauled', 'overhaul'], ['oversaw', 'oversee'], ['owned', 'own'],
  ['partnered', 'partner'], ['performed', 'perform'], ['piloted', 'pilot'],
  ['pioneered', 'pioneer'], ['planned', 'plan'], ['positioned', 'position'],
  ['prepared', 'prepare'], ['presented', 'present'], ['prevented', 'prevent'],
  ['prioritised', 'prioritise'], ['processed', 'process'], ['procured', 'procure'],
  ['produced', 'produce'], ['programmed', 'program'], ['promoted', 'promote'],
  ['proposed', 'propose'], ['prototyped', 'prototype'], ['provided', 'provide'],
  ['published', 'publish'], ['purchased', 'purchase'], ['quantified', 'quantify'],
  ['raised', 'raise'], ['ran', 'run'], ['rationalised', 'rationalise'],
  ['rebuilt', 'rebuild'], ['recommended', 'recommend'], ['reconciled', 'reconcile'],
  ['recovered', 'recover'], ['recruited', 'recruit'], ['redesigned', 'redesign'],
  ['reduced', 'reduce'], ['refactored', 'refactor'], ['refined', 'refine'],
  ['registered', 'register'], ['regulated', 'regulate'], ['reinforced', 'reinforce'],
  ['released', 'release'], ['remediated', 'remediate'], ['removed', 'remove'],
  ['reorganised', 'reorganise'], ['repaired', 'repair'], ['replaced', 'replace'],
  ['reported', 'report'], ['researched', 'research'], ['resolved', 'resolve'],
  ['restored', 'restore'], ['restructured', 'restructure'], ['retained', 'retain'],
  ['reviewed', 'review'], ['revised', 'revise'], ['revitalised', 'revitalise'],
  ['rewrote', 'rewrite'], ['saved', 'save'], ['scaled', 'scale'],
  ['scheduled', 'schedule'], ['screened', 'screen'], ['secured', 'secure'],
  ['selected', 'select'], ['served', 'serve'], ['shaped', 'shape'],
  ['shipped', 'ship'], ['simplified', 'simplify'], ['sold', 'sell'],
  ['solved', 'solve'], ['sourced', 'source'], ['spearheaded', 'spearhead'],
  ['specified', 'specify'], ['sponsored', 'sponsor'], ['staffed', 'staff'],
  ['standardised', 'standardise'], ['steered', 'steer'], ['streamlined', 'streamline'],
  ['strengthened', 'strengthen'], ['structured', 'structure'], ['studied', 'study'],
  ['supervised', 'supervise'], ['supported', 'support'], ['surveyed', 'survey'],
  ['sustained', 'sustain'], ['synthesised', 'synthesise'], ['systematised', 'systematise'],
  ['targeted', 'target'], ['taught', 'teach'], ['tested', 'test'],
  ['tightened', 'tighten'], ['tracked', 'track'], ['trained', 'train'],
  ['transformed', 'transform'], ['translated', 'translate'], ['trebled', 'treble'],
  ['tripled', 'triple'], ['troubleshot', 'troubleshoot'], ['turned', 'turn'],
  ['unified', 'unify'], ['upgraded', 'upgrade'], ['validated', 'validate'],
  ['verified', 'verify'], ['won', 'win'], ['wrote', 'write'],
];

// Present-tense form -> canonical (past) form, and past -> itself. Lets D07
// count "Managed" and "Manage" as the same verb used twice.
export const VERB_LEMMA = new Map();
export const PRESENT_FORMS = new Set();
export const PAST_FORMS = new Set();
for (const [past, present] of ACTION_VERBS) {
  VERB_LEMMA.set(past, past);
  VERB_LEMMA.set(present, past);
  PAST_FORMS.add(past);
  PRESENT_FORMS.add(present);
  // "Leading a team of 12" opens with a verb just as much as "Led a team".
  const ing = present.endsWith('e') ? `${present.slice(0, -1)}ing` : `${present}ing`;
  VERB_LEMMA.set(ing, past);
}

/** The lemma of a word if it is a known action verb, else null. */
export function verbLemma(word) {
  return VERB_LEMMA.get(String(word || '').toLowerCase().replace(/[^a-z]/g, '')) || null;
}

/** Which tense a word is in, when it is a recognised verb. */
export function verbTense(word) {
  const clean = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (PAST_FORMS.has(clean)) return 'past';
  if (PRESENT_FORMS.has(clean)) return 'present';
  return null;
}
