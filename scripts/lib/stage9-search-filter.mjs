export const STAGE9_SEARCH_FILTER_VERSION='1.0.0-v120';

// UI count is intentionally data/config driven. Initial UX exposes four facets,
// but adding a facet later does not require changing eligibility logic.
export const DEFAULT_SEARCH_FILTERS=Object.freeze([
  {id:'region',label:'지역',type:'multi-checkbox',enabled:true},
  {id:'organization',label:'기관',type:'multi-checkbox',enabled:true},
  {id:'jobCategory',label:'직무',type:'multi-checkbox',enabled:true},
  {id:'employmentType',label:'고용형태',type:'multi-checkbox',enabled:true}
]);

export function activeFilterDefinitions(config=DEFAULT_SEARCH_FILTERS){ return (config||[]).filter(x=>x?.enabled!==false); }
export function applySearchPreferenceFilters(rows=[], selections={}, config=DEFAULT_SEARCH_FILTERS){
  const defs=activeFilterDefinitions(config);
  return rows.filter(row=>{
    if(row?.eligibility?.status!=='eligible') return false;
    for(const def of defs){
      const selected=Array.isArray(selections?.[def.id])?selections[def.id].filter(Boolean):[];
      if(!selected.length) continue;
      const values=Array.isArray(row?.searchFacets?.[def.id])?row.searchFacets[def.id]:[];
      if(!selected.some(v=>values.includes(v))) return false;
    }
    return true;
  });
}
