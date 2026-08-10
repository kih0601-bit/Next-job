export const SOURCE_MAPS = Object.freeze({
  'job-alio': Object.freeze({
    sourceId: ['recrutPblntSn'],
    institution: ['instNm'],
    title: ['recrutPbancTtl'],
    applyStart: ['pbancBgngYmd'],
    applyEnd: ['pbancEndYmd'],
    employmentType: ['hireTypeNmLst'],
    workplaces: ['workRgnNmLst'],
    headcount: ['recrutNope'],
    sourceUrl: ['srcUrl'],
    detailText: ['aplyQlfcCn'],
    education: ['acbgCondNmLst'],
    preferenceText: ['prefCondCn','prefCn'],
    disqualificationText: ['disqlfcRsn'],
    recruitmentType: ['recrutSeNm'],
    jobCategory: ['ncsCdNmLst'],
  }),
  cleaneye: Object.freeze({
    sourceId: ['NO'],
    institution: ['ENT_NAME'],
    title: ['ENT_TITLE'],
    applyStart: ['PUB_DATE'],
    applyEnd: ['PUB_END_DATE'],
    employmentType: ['JOB_TYPE'],
    workplaces: ['WORK_PLACE'],
    headcount: ['EMPLOY_NUM'],
    sourceUrl: ['URL'],
    detailText: ['JOB_SEEK_ETC','DUTY_DETAIL'],
    education: [],
    preferenceText: ['SPECIAL_ITEM'],
    disqualificationText: [],
    recruitmentType: ['EMPLOY_GB'],
    jobCategory: ['ENT_RECRUIT'],
    localRestrictionFlag: ['LOCAL_YN'],
    localRestrictionName: ['LOCAL_NAME'],
    licenses: ['ENT_LICENSE1','ENT_LICENSE2','ENT_LICENSE3','ENT_LICENSE4'],
    reference: ['EXHIBIT','REFERENCE'],
  }),
  narailter: Object.freeze({
    // 나라일터는 v136에서 운영 투입 보류. 실제 최신 응답 샘플 확보 후 명시 매핑한다.
    sourceId: [], institution: [], title: [], applyStart: [], applyEnd: [],
    employmentType: [], workplaces: [], headcount: [], sourceUrl: [], detailText: [],
    education: [], preferenceText: [], disqualificationText: [], recruitmentType: [], jobCategory: [],
  }),
});

export function sourceMap(source) {
  const map = SOURCE_MAPS[source];
  if (!map) throw new Error(`Unsupported source: ${source}`);
  return map;
}
