import { extractionJsonSchema } from '../lib/schema.mjs';

export async function extractWithOpenAI(posting, evidenceBundle) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.NEXTJOB_AI_MODEL;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  if (!model) throw new Error('NEXTJOB_AI_MODEL is required (pinned model ID recommended)');

  const prompt = `당신은 공공기관 채용 원문 구조화 엔진이다.\n규칙:\n1) 추측 금지. 확인 불가하면 unknown.\n2) 공고 제목을 모집단위 이름 fallback으로 사용하지 않는다.\n3) 결과발표/예비공고/연간계획/임원공모를 일반 recruitment로 만들지 않는다.\n4) required는 반드시 evidenceIds를 가진다.\n5) AND/OR 관계를 보존한다.\n6) * 또는 접근성 문구/테이블 설명을 unitName으로 만들지 않는다.\n\nPOSTING:\n${JSON.stringify(posting)}\n\nEVIDENCE:\n${JSON.stringify(evidenceBundle)}`;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      store:false,
      input:[{role:'user',content:[{type:'input_text',text:prompt}]}],
      text:{format:{type:'json_schema',name:'next_job_extraction',strict:true,schema:extractionJsonSchema}}
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const txt = data.output_text || data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
  if (!txt) throw new Error('OpenAI response has no output_text');
  return JSON.parse(txt);
}
