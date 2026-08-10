export const STAGE9_JOB_TAXONOMY_VERSION = '1.1.0-v121';

export const JOB_CATEGORIES = Object.freeze([
  { id:'medical-health', label:'의료·보건', description:'의사·간호·보건의료 등 의료/보건 전문직', patterns:[/의사|간호|수의|약사|의료|보건의학|산업보건\s*[-(]?의학/i] },
  { id:'safety-health', label:'안전·보건', description:'산업안전·산업보건·재난·안전관리', patterns:[/산업안전|산업보건|건설안전|안전관리|재난안전|안전점검|산업재해|보건관리/i] },
  { id:'it-digital', label:'IT·디지털', description:'SW·AI·데이터·정보보안·정보시스템·전산', patterns:[/ICT|SW\b|소프트웨어|AI\b|인공지능|데이터|정보보안|정보기술|전산|네트워크|시스템\s*(?:개발|운영|관리)|디지털|애플리케이션|플랫폼/i] },
  { id:'electrical-electronics', label:'전기·전자', description:'전기·전자·전력·통신설비 기술직', patterns:[/전기|전자|전력|전기설비|전기안전|통신설비/i] },
  { id:'mechanical-equipment', label:'기계·설비', description:'기계·설비·자동차·조선 기계기술직', patterns:[/기계|기계설비|설비기술|자동차기술|조선기술|메카트로닉스/i] },
  { id:'chemical-materials', label:'화학·소재', description:'화공·화학·소재·석유화학 기술직', patterns:[/화공|화학|소재|석유화학/i] },
  { id:'construction-civil', label:'건축·토목', description:'건축·토목·도시·건설 기술직', patterns:[/건축|토목|도시개발|도시재생|건설기술/i] },
  { id:'environment-energy', label:'환경·에너지', description:'환경·수질·대기·폐기물·에너지 기술직', patterns:[/환경|수질|대기|폐기물|에너지|녹지/i] },
  { id:'research-rd', label:'연구·R&D', description:'연구직·시험·분석·기술개발 중심 직무', patterns:[/연구직|연구원|R&D|연구개발|시험평가|시험분석|기술개발/i] },
  { id:'finance-accounting', label:'재무·회계', description:'재무·회계·세무·예산·결산', patterns:[/재무|회계|세무|결산|예산관리/i] },
  { id:'project-operation', label:'사업기획·운영', description:'공공사업·프로젝트 기획/운영/수행/관리', patterns:[/사업\s*(?:기획|운영|수행|관리|지원)|프로젝트\s*(?:기획|운영|관리)|사업계획|구축사업\s*(?:운영|관리)/i] },
  { id:'admin-management', label:'사무·행정', description:'일반행정·사무·경영지원·기획·총무·인사 및 일반채용 직군', patterns:[/일반행정|행정|사무|경영지원|경영관리|총무|인사|기획조정|사무보조|비서|신입직\s*\d*급\s*(?:일반|지역인재|장애)/i] },
  { id:'facility-field', label:'시설·현장운영', description:'시설관리·유지보수·청소·경비·현장운영', patterns:[/시설관리|시설운영|유지보수|청소|경비|현장운영|공무직/i] },
  { id:'customer-service', label:'고객·서비스', description:'민원·안내·상담·예약·매표·고객지원', patterns:[/고객|민원|안내|상담|예약|매표|콜센터|전화응대/i] },
  { id:'driving-logistics', label:'운전·운송', description:'운전·차량·운송·물류 현장직', patterns:[/운전|운송|차량|버스|물류/i] },
  { id:'other', label:'기타', description:'현재 표준 직무군으로 확정하기 어려운 직무', patterns:[] }
]);

const genericUnit = s => !s || /^(?:모집분야\s*\d+|\*|알림마당|.*채용\s*공고|.*직원\s*채용\s*공고|.*\.pdf|###)/i.test(String(s).trim());
const classifyText = (text, matchedOn, confidence) => {
  for (const category of JOB_CATEGORIES) {
    if (category.id === 'other') continue;
    const pattern = category.patterns.find(p=>p.test(text));
    if (pattern) return { id:category.id, label:category.label, confidence, matchedOn, matchedPattern:String(pattern) };
  }
  return null;
};

export function classifyJobCategory({ vacancyName='', title='', localText='' }={}) {
  // Unit name has highest authority. Shared posting title must not steal a category
  // from a specific recruitment unit.
  const unitResult = classifyText(String(vacancyName), 'unit', 'high');
  if (unitResult) return unitResult;
  const evidenceResult = classifyText(String(localText), 'evidence', 'medium');
  if (evidenceResult) return evidenceResult;
  // Only generic unit names may fall back to the posting title.
  if (genericUnit(vacancyName)) {
    const titleResult = classifyText(String(title), 'title-fallback', 'low');
    if (titleResult) return titleResult;
  }
  return { id:'other', label:'기타', confidence:'low', matchedOn:'none', matchedPattern:'' };
}
