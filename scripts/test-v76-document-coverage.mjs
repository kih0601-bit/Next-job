
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { extractAttachments } from './lib/detail-parser.mjs';

{
  const html = `<div class="file_area">
    <a href="/download.html?fi=1">직무기술서.pdf</a>
    <img src="/webuser/img/ico_download.png" alt="파일 다운로드">
    <img src="/data/upload/board/poster.jpg" alt="채용 포스터">
  </div>`;
  const files = extractAttachments(html,'https://example.org/view.html');
  assert.equal(files.length,1);
  assert.match(files[0].name,/직무기술서/);
}
{
  const html = `<div class="attachment-area"><img src="/data/upload/board/recruit_notice.jpg" alt="2026년 직원 채용 공고"></div>`;
  const files = extractAttachments(html,'https://example.org/view.html');
  assert.equal(files.length,1);
  assert.match(files[0].url,/recruit_notice\.jpg/);
}
{
  const html = `<form action="/board/download.do" method="post" class="attachment-file-area">
    <input type="hidden" name="fileId" value="FILE_456"><button>첨부파일 다운로드</button></form>`;
  const files = extractAttachments(html,'https://example.org/view.do');
  assert.equal(files[0]?.method,'POST');
}
{
  const probe=await fs.readFile(new URL('./pipeline-probe.mjs',import.meta.url),'utf8');
  const collect=await fs.readFile(new URL('./collect.mjs',import.meta.url),'utf8');
  for (const s of [probe,collect]) { assert.match(s,/capabilityOk/); assert.match(s,/coverageStatus/); assert.match(s,/coverageRatio/); }
  assert.match(collect,/ok:\s*parsed === documentAttempted/);
}
console.log('v76-document-coverage-pass');
