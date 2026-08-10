
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { extractAttachments } from './lib/detail-parser.mjs';
{
 const files=extractAttachments(`<div class="file"><a href="#LINK" onclick="javascript:fn_egov_downFile('abc%2Fdef%3D')">신규직원 채용공고.pdf</a></div>`,'https://www.uic.or.kr/uimc/notify/noti06/selectEmploymentArticle.do');
 const hit=files.find(x=>/FileDownNotice\.do/.test(x.url)); assert.ok(hit); assert.match(hit.url,/abc%2Fdef%3D/);
}
{
 const files=extractAttachments(`<div class="file"><a href="#" onclick="javascript:fileDownload('25','2','job'); return false;">직무기술서.pdf</a></div>`,'https://www.energy.or.kr/front/board/etc/jobView.do');
 const hit=files.find(x=>/commonFile\/fileDownload\.do/.test(x.url)); assert.ok(hit); assert.equal(hit.method,'POST'); assert.match(hit.body,/fileNo=25/); assert.match(hit.body,/fileSeq=2/); assert.match(hit.body,/boardMngNo=job/);
}
{
 const files=extractAttachments(`<div class="file"><a href="/u">울산웨일즈야구단 사무국 직원 채용 공고문.hwpx</a><a href="/u/enc/convert/encBoardFile.ulsan?atchFileId=AAA%2B%3D&fileSn=BBB%3D%3D">미리보기</a><a href="/u/enc/convert/encBoardFile.ulsan?atchFileId=AAA%2B%3D&fileSn=BBB%3D%3D&initTTS=true">미리듣기</a></div>`,'https://www.ulsan.go.kr/u/rep/bbs/view.do?dataId=1');
 assert.equal(files.length,1); assert.equal(files[0].resolver,'ULSAN_ENC_BOARD_FILE'); assert.equal(files[0].type,'hwpx');
}
{
 const analyzer=await fs.readFile(new URL('./lib/document-analyzer.mjs',import.meta.url),'utf8');
 assert.match(analyzer,/Array\.isArray\(directInfo\)/); assert.match(analyzer,/resolveUlsanEncryptedBoardFile/); assert.match(analyzer,/libreoffice-hwp-fallback/); assert.match(analyzer,/2\.8-legacy-office-pdf-fallback/);
}
console.log('v77-remaining-five-pass');
