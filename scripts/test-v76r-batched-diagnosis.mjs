
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { extractAttachments } from './lib/detail-parser.mjs';

{
  const html = `<div class="file_area">
    <a href="/cms/download/downloadFile2.hrd">★2026 채용공고.pdf</a>
    <a href="/cms/download/downloadFile.hrd?attachSeq=2053319">PDF파일 다운</a>
  </div>`;
  const files=extractAttachments(html,'https://www.hrdkorea.or.kr/3/1/2/2?k=56000');
  assert.equal(files.length,1);
  assert.match(files[0].url,/downloadFile\.hrd\?attachSeq=2053319/);
}
{
  const detail=await fs.readFile(new URL('./lib/detail-parser.mjs',import.meta.url),'utf8');
  const analyzer=await fs.readFile(new URL('./lib/document-analyzer.mjs',import.meta.url),'utf8');
  assert.match(detail,/writeAttachmentResolutionDiagnostic/);
  assert.match(detail,/울산시설공단/);
  assert.match(detail,/한국에너지공단/);
  assert.match(detail,/filename = `\$\{base\}-external-\$\{index \+ 1\}\.js`/);
  assert.match(analyzer,/findKoshaFileDownInfo/);
  assert.match(analyzer,/writeKoshaDownloadEvidence/);
  assert.match(analyzer,/fileDown-response\.json/);
}
console.log('v76r-batched-diagnosis-pass');
