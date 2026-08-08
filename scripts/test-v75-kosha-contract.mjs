
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const detail = await fs.readFile(new URL('./lib/detail-parser.mjs', import.meta.url),'utf8');
const analyzer = await fs.readFile(new URL('./lib/document-analyzer.mjs', import.meta.url),'utf8');

assert.match(detail,/KOSHA_TBOARD_FILE/);
assert.match(detail,/bbsAtcflNo/);
assert.match(detail,/bbsOrgnlAtcflNm/);
assert.match(analyzer,/serviceId:\s*'fileDown'/);
assert.match(analyzer,/stdtboard\/fileDownload\.do/);
assert.match(analyzer,/resolveHtmlAttachmentGateway/);
assert.match(analyzer,/egovAlternateDownloadItem/);
assert.match(analyzer,/2\.2-attachment-resolution/);
console.log('v75-kosha-contract-pass');
