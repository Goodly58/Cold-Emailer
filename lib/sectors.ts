/**
 * The company database carries very specific sector labels ("Islamic Banking",
 * "Money Exchange & Remittance", "Wildlife Park & Attractions") because that
 * detail is useful when you're reading a single row. It's useless for
 * filtering — there are hundreds of distinct values. This maps each to a
 * broad group so the Companies page can offer a usable filter.
 */

export const SECTOR_GROUPS = [
  'Banking & Finance',
  'Energy & Utilities',
  'Technology',
  'Government & Public',
  'Healthcare',
  'Education',
  'Real Estate & Construction',
  'Transport & Logistics',
  'Retail & Consumer',
  'Hospitality & Tourism',
  'Professional Services',
  'Industry & Manufacturing',
  'Media & Telecom',
  'Other',
] as const;

export type SectorGroup = (typeof SECTOR_GROUPS)[number];

/** Checked in order — the first matching rule wins, so put specific before general. */
const RULES: Array<[RegExp, SectorGroup]> = [
  [/bank|financ|insur|invest|wealth|asset manage|capital|fintech|exchange|remitt|payment|broker|fund|sovereign|securit|credit|takaful|leasing|equity|venture/i, 'Banking & Finance'],
  [/oil|gas|energy|petro|refin|utilit|power|electric|water|nuclear|solar|renewab|hydro|drilling|upstream|downstream|cooling|waste|environment|well flow|fertilizer|ammonia/i, 'Energy & Utilities'],
  [/hospital|health|medic|clinic|pharma|dental|diagnost|biotech|care|wellness|laborator/i, 'Healthcare'],
  [/universit|school|educat|academ|training|nursery|college|institute|kindergarten|edtech|research|campus/i, 'Education'],
  [/government|ministry|authority|municipal|federal|regulat|public sector|council|department|court|police|customs|civil|free zone|chamber|immigration|residency|housing|fire|rescue|emergency|meteorolog|seismolog|museum|cultural heritage|state-owned|statistic/i, 'Government & Public'],
  [/defence|defense|weapon|military|aerospace|autonomous system/i, 'Industry & Manufacturing'],
  [/real estate|propert|construct|contract|develop|engineer|architect|facilit|building|infrastructur|cement|steel fabric|interior/i, 'Real Estate & Construction'],
  [/logistic|shipping|freight|port|transport|aviation|airline|airport|courier|rail|marine|cargo|fleet|taxi|mobilit/i, 'Transport & Logistics'],
  [/hotel|hospitalit|tourism|resort|restaurant|f&b|food service|catering|leisure|entertainment|attraction|travel|park|cinema|dining|qsr|franchise operator|tour operator/i, 'Hospitality & Tourism'],
  [/retail|consumer|fmcg|supermarket|hypermarket|e-commerce|ecommerce|grocer|fashion|luxury|jewell|duty free|trading|distribut|beverage|dairy|mall|confectioner|snack|juice|produce/i, 'Retail & Consumer'],
  [/telecom|mvno|satellite communication|mobile network|media|broadcast|publish|advertis|marketing|public relations|content|film|news/i, 'Media & Telecom'],
  [/tech|software|artificial intelligence|data cent|digital|cyber|cloud|saas|platform|internet|semiconductor|space|robotic|gaming|proptech|healthtech|ict|systems integration|\bai\b|\bit\b/i, 'Technology'],
  [/consult|advisor|legal|law firm|audit|accounting|recruit|staffing|big 4|professional serv|human resource|executive search|market research/i, 'Professional Services'],
  [/manufact|industr|factory|production|chemical|aluminium|aluminum|steel|plastic|packaging|textile|mining|quarry|agricultur|fisher|fabricat|ship repair|maintenance, repair|mro/i, 'Industry & Manufacturing'],
];

export function sectorGroup(sector: string): SectorGroup {
  for (const [pattern, group] of RULES) {
    if (pattern.test(sector)) return group;
  }
  return 'Other';
}
