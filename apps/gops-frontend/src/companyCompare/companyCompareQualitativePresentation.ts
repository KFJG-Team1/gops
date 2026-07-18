import type { CompanyCompareQualitativeItem } from "./companyCompareApi";

type HighlightRule = {
  label: string;
  pattern: RegExp;
};

const MAX_BUSINESS_HIGHLIGHTS = 6;
const MAX_BUSINESS_MODEL_HIGHLIGHTS = 3;
const MAX_REVENUE_HIGHLIGHTS = 4;
const MAX_RISK_HIGHLIGHTS = 3;

const BUSINESS_MODEL_HIGHLIGHT_RULES: HighlightRule[] = [
  { label: "반도체 설계", pattern: /반도체.{0,18}설계|설계.{0,18}반도체/i },
  { label: "팹리스", pattern: /팹리스|fabless/i },
  { label: "외주 생산", pattern: /생산.{0,15}(?:외주|위탁)|외부\s*업체.{0,15}(?:생산|제조)|파운드리/i },
  { label: "자체 생산", pattern: /자체.{0,12}(?:생산|제조)|수직\s*통합/i },
  { label: "하드웨어·소프트웨어", pattern: /하드웨어.{0,30}소프트웨어|소프트웨어.{0,30}하드웨어/i },
  { label: "플랫폼·서비스", pattern: /플랫폼|서비스를?\s*제공|software\s*platform/i },
  { label: "제품 판매", pattern: /제품.{0,12}(?:판매|매출)|하드웨어.{0,12}판매/i },
  { label: "라이선스", pattern: /라이선스|로열티|licens/i },
  { label: "구독", pattern: /구독|subscription/i },
  { label: "광산 운영", pattern: /광산|채굴|mining/i }
];

const BUSINESS_HIGHLIGHT_RULES: HighlightRule[] = [
  { label: "반도체 설계", pattern: /반도체.{0,18}설계|설계.{0,18}반도체/i },
  { label: "AI 반도체", pattern: /(?:AI|인공지능)\s*(?:가속기|반도체|GPU|칩)|가속\s*컴퓨팅/i },
  { label: "데이터센터", pattern: /데이터\s*센터|data\s*center/i },
  { label: "클라이언트 PC", pattern: /클라이언트|PC용|PC\s*(?:CPU|프로세서)|개인용\s*컴퓨터/i },
  { label: "게이밍", pattern: /게이밍|게임용|gaming|GeForce/i },
  { label: "임베디드", pattern: /임베디드|embedded/i },
  { label: "적응형 컴퓨팅", pattern: /적응형\s*컴퓨팅|FPGA/i },
  { label: "네트워킹", pattern: /네트워킹|networking|InfiniBand|Ethernet|NVLink/i },
  { label: "자율주행", pattern: /자율주행|자동차용|automotive/i },
  { label: "소프트웨어 플랫폼", pattern: /CUDA|소프트웨어\s*(?:스택|플랫폼)|software\s*(?:stack|platform)/i },
  { label: "GPU·그래픽", pattern: /\bGPU\b|그래픽\s*프로세서|시각화\s*GPU/i },
  { label: "CPU·프로세서", pattern: /\bCPU\b|프로세서/i },
  { label: "반도체 제조", pattern: /파운드리|웨이퍼|ATMP|반도체.{0,18}제조|제조.{0,18}반도체/i },
  { label: "IP·라이선스", pattern: /IP\s*(?:포트폴리오|라이선스)|지식재산|라이선스\s*수익/i },
  { label: "클라우드", pattern: /클라우드|cloud/i },
  { label: "검색", pattern: /검색\s*(?:서비스|광고|엔진)/i },
  { label: "광고", pattern: /광고\s*(?:사업|플랫폼|서비스)/i },
  { label: "전자상거래", pattern: /전자상거래|e-?commerce/i },
  { label: "전기차", pattern: /전기차|electric\s*vehicle/i },
  { label: "금 생산", pattern: /금\s*(?:생산|채굴)|gold\s*(?:production|mining)/i },
  { label: "구리 생산", pattern: /구리\s*(?:생산|채굴)|copper\s*(?:production|mining)/i },
  { label: "광산 개발", pattern: /광산\s*(?:개발|운영)|광업|mining\s*operation/i }
];

const REVENUE_HIGHLIGHT_RULES: HighlightRule[] = [
  { label: "하드웨어 판매", pattern: /하드웨어.{0,12}판매|장비.{0,12}판매/i },
  { label: "제품 판매", pattern: /제품.{0,12}(?:판매|매출)|제품군.{0,12}매출/i },
  { label: "소프트웨어 라이선스", pattern: /소프트웨어.{0,15}라이선스/i },
  { label: "IP·로열티", pattern: /IP.{0,15}(?:판매|라이선스)|지식재산|로열티/i },
  { label: "플랫폼·서비스", pattern: /플랫폼.{0,15}(?:서비스|매출|판매)|서비스\s*수익/i },
  { label: "NRE 수수료", pattern: /\bNRE\b|비반복\s*엔지니어링/i },
  { label: "구독", pattern: /구독|subscription/i },
  { label: "광고", pattern: /광고\s*(?:매출|수익|사업)/i },
  { label: "거래·중개 수수료", pattern: /거래\s*수수료|중개\s*수수료/i },
  { label: "금·구리 판매", pattern: /금.{0,12}(?:판매|매출)|구리.{0,12}(?:판매|매출)/i }
];

const RISK_HIGHLIGHT_RULES: HighlightRule[] = [
  { label: "신제품 전환·출시 지연", pattern: /신제품|제품\s*전환|기술\s*전환|출시.{0,12}지연/i },
  { label: "품질·생산 차질", pattern: /품질|생산\s*(?:문제|차질)|제품\s*결함|호환성\s*문제/i },
  { label: "설계 채택 실패", pattern: /설계\s*채택/i },
  { label: "시장점유율 하락", pattern: /시장\s*점유율|점유율\s*하락/i },
  { label: "가격·수요 압박", pattern: /가격\s*(?:하락|압박|경쟁|인하)|수요\s*(?:감소|둔화)/i },
  { label: "생태계 경쟁력 약화", pattern: /생태계|소프트웨어.{0,12}(?:격차|지원|경쟁)/i },
  { label: "고객 자체칩 확산", pattern: /자체.{0,12}(?:칩|반도체|개발)|내재화/i },
  { label: "공급망 제약", pattern: /공급\s*(?:제약|차질|부족)|공급망|파운드리|원자재|희소\s*투입물/i },
  { label: "확장 인프라 부족", pattern: /인프라.{0,12}(?:확보|부족|확장)/i },
  { label: "IP·라이선스 의존", pattern: /\bIP\b|지식재산|특허|라이선스/i },
  { label: "외부 파트너 의존", pattern: /제3자|외부\s*업체|벤더\s*(?:지원|의존)/i },
  { label: "핵심 인력 의존", pattern: /핵심\s*인력|인재\s*(?:확보|이탈)|인력\s*의존/i },
  { label: "규제·법률 리스크", pattern: /규제|수출\s*통제|법률|소송/i },
  { label: "보안 취약점", pattern: /사이버|정보\s*보안|보안\s*취약점/i },
  { label: "IT 시스템 장애", pattern: /IT\s*시스템|시스템\s*장애/i },
  { label: "경기·수요 변동", pattern: /경기\s*(?:침체|변동)|거시경제|수요\s*변동/i },
  { label: "고객 집중", pattern: /고객\s*집중|주요\s*고객.{0,12}의존/i },
  { label: "환율 변동", pattern: /환율|외환/i },
  { label: "지정학적 불확실성", pattern: /지정학|무역\s*분쟁|관세/i },
  { label: "파트너십·인수 경쟁", pattern: /파트너십|인수\s*합병|M&A/i },
  { label: "대체 아키텍처 확산", pattern: /대체\s*아키텍처|\bArm\b/i }
];

export function buildBusinessModelHighlights(
  item: CompanyCompareQualitativeItem | null | undefined
): string[] {
  if (!item) return [];

  const structured = splitStructuredPhrases(item.structure, MAX_BUSINESS_MODEL_HIGHLIGHTS);
  if (structured.length > 0) return structured;

  const source = normalizeText(item.summary);
  const matched = matchHighlights(
    source,
    BUSINESS_MODEL_HIGHLIGHT_RULES,
    MAX_BUSINESS_MODEL_HIGHLIGHTS
  );
  if (matched.length > 0) return matched;
  return fallbackPhrases(source, MAX_BUSINESS_MODEL_HIGHLIGHTS);
}

export function buildBusinessHighlights(
  item: CompanyCompareQualitativeItem | null | undefined
): string[] {
  if (!item) return [];

  const source = [
    item.summary,
    item.structure,
    ...(item.segments ?? []).flatMap((segment) => [segment.name, segment.detail]),
    ...(item.revenueModel ?? []),
    item.platform
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");

  const matched = matchHighlights(source, BUSINESS_HIGHLIGHT_RULES, MAX_BUSINESS_HIGHLIGHTS);
  if (matched.length >= 2) return matched;

  const segmentNames = uniqueCompactPhrases(
    (item.segments ?? []).map((segment) => segment.name),
    MAX_BUSINESS_HIGHLIGHTS
  );
  if (segmentNames.length > 0) {
    return [...matched, ...segmentNames.filter((name) => !matched.includes(name))]
      .slice(0, MAX_BUSINESS_HIGHLIGHTS);
  }

  const enumeratedNames = extractEnumeratedBusinessNames(source);
  if (enumeratedNames.length > 0) {
    return [...matched, ...enumeratedNames.filter((name) => !matched.includes(name))]
      .slice(0, MAX_BUSINESS_HIGHLIGHTS);
  }

  return [...matched, ...fallbackPhrases(item.summary, MAX_BUSINESS_HIGHLIGHTS - matched.length)]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_BUSINESS_HIGHLIGHTS);
}

export function buildRevenueHighlights(
  item: CompanyCompareQualitativeItem | null | undefined
): string[] {
  if (!item) return [];

  const structured = uniqueCompactPhrases(item.revenueModel ?? [], MAX_REVENUE_HIGHLIGHTS);
  if (structured.length > 0) return structured;

  return matchHighlights(
    normalizeText(item.summary),
    REVENUE_HIGHLIGHT_RULES,
    MAX_REVENUE_HIGHLIGHTS
  );
}

export function buildRiskHighlights(summary: string | null | undefined): string[] {
  const source = normalizeText(summary);
  if (!source) return [];

  const matched = RISK_HIGHLIGHT_RULES
    .map((rule) => {
      const match = source.match(rule.pattern);
      return match?.index === undefined ? null : { label: rule.label, index: match.index };
    })
    .filter((value): value is { label: string; index: number } => value !== null)
    .sort((left, right) => left.index - right.index)
    .filter((value, index, values) => values.findIndex((candidate) => candidate.label === value.label) === index)
    .slice(0, MAX_RISK_HIGHLIGHTS)
    .map((value) => value.label);

  if (matched.length >= MAX_RISK_HIGHLIGHTS) return matched;

  return [...matched, ...fallbackPhrases(source, MAX_RISK_HIGHLIGHTS - matched.length)]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_RISK_HIGHLIGHTS);
}

function matchHighlights(source: string, rules: HighlightRule[], limit: number): string[] {
  if (!source) return [];
  return rules
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => rule.label)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, limit);
}

function extractEnumeratedBusinessNames(source: string): string[] {
  const matches = [...source.matchAll(/\(\d+\)\s*([^(:：.;]{2,48})(?=\s*(?:\(|:|：))/g)];
  return uniqueCompactPhrases(matches.map((match) => match[1] ?? ""), MAX_BUSINESS_HIGHLIGHTS);
}

function splitStructuredPhrases(source: string | null | undefined, limit: number): string[] {
  const normalized = normalizeText(source);
  if (!normalized) return [];
  return uniqueCompactPhrases(
    normalized.split(/\s*(?:—|–|\||;|,)\s*/),
    limit
  );
}

function uniqueCompactPhrases(values: string[], limit: number): string[] {
  return values
    .map(compactPhrase)
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index)
    .slice(0, limit);
}

function fallbackPhrases(source: string | null | undefined, limit: number): string[] {
  if (limit <= 0) return [];
  const normalized = normalizeText(source);
  if (!normalized) return [];

  return normalized
    .split(/[.;。]\s*|\n+|,\s*(?=[가-힣A-Z0-9])/)
    .map(compactPhrase)
    .filter((value) => value.length >= 2)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, limit);
}

function compactPhrase(value: string): string {
  const normalized = normalizeText(value)
    .replace(/^[A-Z0-9.\-]{1,12}(?:는|은|이|가)?\s*/i, "")
    .replace(/^(?:회사는|제품은|제품이|시장은)\s*/, "")
    .replace(/\s*(?:할|될|있을)\s*수\s*(?:있다|있습니다|있으며).*$/, "")
    .replace(/\s*(?:합니다|됩니다|입니다|있습니다|있다|된다)\.?$/, "")
    .replace(/[,:;.\-–—]\s*$/, "")
    .trim();
  if (normalized.length <= 26) return normalized;
  return `${normalized.slice(0, 25).trim()}…`;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
