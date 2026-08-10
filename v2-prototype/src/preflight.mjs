const checks=[];
function add(name,ok,detail=''){checks.push({name,ok,detail});}
add('DATA_GO_KR_SERVICE_KEY',!!process.env.DATA_GO_KR_SERVICE_KEY,'required for live public-data API calls');
add('OPENAI_API_KEY',!!process.env.OPENAI_API_KEY,'required for AI benchmark capture');
add('NEXTJOB_AI_MODEL',!!process.env.NEXTJOB_AI_MODEL,'workflow pins a model unless overridden');
const required=checks.filter(x=>['DATA_GO_KR_SERVICE_KEY','OPENAI_API_KEY','NEXTJOB_AI_MODEL'].includes(x.name));
console.log(JSON.stringify({ok:required.every(x=>x.ok),checks},null,2));
if(process.argv.includes('--strict') && !required.every(x=>x.ok)) process.exit(2);
