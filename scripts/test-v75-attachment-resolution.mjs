
import assert from 'node:assert/strict';
import { extractAttachments } from './lib/detail-parser.mjs';

// UIC: a board-list form containing file-ish hidden fields is not an attachment.
{
  const html = `<form name="frm" method="post" action="/uimc/notify/noti06/selectEmploymentList.do">
    <input type="hidden" name="fileNo" value="1">
    <input type="hidden" name="employmentId" value="22">
  </form>`;
  assert.equal(extractAttachments(html,'https://www.uic.or.kr/uimc/notify/noti06/selectEmploymentArticle.do').length,0);
}

// UPA: KOGL/public-license image is chrome, not a recruitment document.
{
  const html = `<div class="file_area"><img src="/common/img/KOGL/new_img_opentype04.png"
    alt="공공누리 제4유형: 출처표시 + 상업적 이용 및 변경 금지"></div>`;
  assert.equal(extractAttachments(html,'https://www.upa.or.kr/portal/board/post/view.do').length,0);
}

// Genuine eGov document links remain accepted.
{
  const html = `<div class="file_area"><a href="/cmm/fms/FileDown.do?atchFileId=FILE_123&fileSn=0"
    title="채용공고.pdf 다운로드">채용공고.pdf</a></div>`;
  const files = extractAttachments(html,'https://example.org/board/view.do');
  assert.equal(files.length,1);
  assert.match(files[0].url,/FileDown\.do/);
}

console.log('v75-attachment-resolution-pass');
