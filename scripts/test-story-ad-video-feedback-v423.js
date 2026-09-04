'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.OUTPUT_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vido-feedback-'));process.env.DB_ENABLED='0';
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const failure=require('../src/services/newStoryAd/publicFailureProjectionService');
const storage=require('../src/services/newStoryAd/storageService');
const load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
(async()=>{
 const ui=await load(read('public/story-ad/components/ui.js'));
 const feedback=await load(read('public/story-ad/views/finalView.js').replace(/^import .*;\r?\n/gm,''));
 const base={project:{id:'task-'+ 'a'.repeat(180),status:'failed',stage:'video_failed',generation_progress:{stage:'video',status:'failed',completed:1,failed:1,generated:0,total:7,started_at:'2026-09-03T07:49:13Z'},technical_diagnostics:{error:'private sound configuration error',error_code:'SOUND_GENERATION_MODEL_NOT_ALIGNED'}},storyboard:{shots:Array.from({length:7},()=>({}))},generation:{clips:[],approved_frames:Array.from({length:7},()=>({}))},permissions:{can_view_errors:false}};
 const view=b=>feedback.videoGenerationFeedback(b),html=b=>feedback.videoGenerationFeedbackMarkup(b,ui.escapeHtml);
 assert.equal(ui.generationProgressOwningView('video_failed'),'compose');
 assert.equal(ui.generationProgressPanel(base,'compose'),'');
 assert.equal(view(base).status,'failed');assert.equal(view(base).completed,0);assert.match(html(base),/视频成功 0\/7/);assert(!html(base).includes('private'));
 assert.match(html({...base,permissions:{can_view_errors:true}}),/private sound/);
 const running={...base,project:{...base.project,status:'running',active_generation_id:'new-run',generation_progress:{stage:'video',status:'running',generated:2,qa_passed:2,total:7}}};
 assert.equal(view(running).status,'running');assert.equal(view(running).completed,2);assert(!html(running).includes('private'));
 const queued={...running,project:{...running.project,status:'queued'}};assert.match(html(queued),/等待生成/);assert(!html(queued).includes('生成成功'));
 const partial={...base,generation:{clips:[{},{}]}};assert.equal(view(partial).completed,2);assert.match(html(partial),/部分完成/);
 const stopped={...partial,project:{...base.project,status:'cancelled'}};assert.equal(view(stopped).status,'stopped');
 const complete={...base,project:{status:'done',stage:'video_done'},generation:{clips:Array(3).fill({}),media_catalog:{clips:{total:7}}}};assert.equal(view(complete).status,'succeeded');assert.equal(view(complete).completed,7);
 assert.equal(view({...base,project:{status:'done',stage:'video_done'}}).status,'incomplete');
 const idle={...base,project:{status:'done',stage:'tts_done'}};assert.equal(view(idle).status,'idle');
 const record=storage.saveStage(base.project.id,'video_submission',{status:'failed',error:'private config <script>',diagnostics:{error_code:'INTERNAL_CONFIG'}});
 assert.equal(storage.getStage(base.project.id,'video_submission').error,record.error);
 const ordinary=failure.submissionFailure(record,false),admin=failure.submissionFailure(record,true);
 assert(!JSON.stringify(ordinary).includes('private'));assert.equal(admin.technical_diagnostics.error_code,'INTERNAL_CONFIG');
 const stalePlanRecord=storage.saveStage(base.project.id,'video_submission',{status:'failed',error:'stale plan',diagnostics:{error_code:'GENERATION_ACTIVE_PLAN_REQUIRED'}});
 assert.equal(failure.submissionFailure(stalePlanRecord,false,{activePlanEligible:true}),null);
 assert(failure.submissionFailure(stalePlanRecord,false,{activePlanEligible:false}));
 assert.equal(failure.submissionFailure({...stalePlanRecord,status:'ready'},false),null);
 const rejected={...idle,project:{...idle.project,video_submission_failure:ordinary}};assert.equal(view(rejected).status,'failed');
 const retry={...running,project:{...running.project,video_submission_failure:ordinary,generation_started_at:new Date(Date.now()+1000).toISOString()}};assert.equal(view(retry).status,'running');
 const retryDone={...complete,project:{...complete.project,video_submission_failure:ordinary,generation_started_at:new Date(Date.now()+1000).toISOString()}};assert.equal(view(retryDone).status,'succeeded');
 assert.equal(failure.project({stage:'video_failed',error:'private error',error_code:'SOUND_GENERATION_MODEL_NOT_ALIGNED'}).public_error,'视频生成失败。');
 assert.equal(failure.publicProgress({stage:'video',generated:2}).generated,2);
 const source=read('public/story-ad/views/finalView.js');assert.match(source,/bindVideoGenerationFeedback\(host, context, escapeHtml\)/);assert.match(source,/data-video-feedback-host/);assert.match(source,/project-progress-track/);

 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);assert(chrome,'browser required');
 const browser=await require('puppeteer-core').launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setContent('<div id="status"></div><div data-video-empty>还没有分镜视频</div><button data-generate-video>生成</button><button data-compose>合成</button>');
  await page.addScriptTag({content:read('public/story-ad/views/finalView.js').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')});
  for(const [bundle,status,disabled,empty] of [[idle,'idle',false,false],[queued,'running',true,true],[running,'running',true,true],[base,'failed',false,true],[partial,'failed',false,true],[complete,'succeeded',false,true]]){
   const result=await page.evaluate(bundle=>{document.querySelector('#status').innerHTML=videoGenerationFeedbackMarkup(bundle,s=>String(s).replaceAll('<','&lt;'));syncVideoGenerationControls(bundle);return {status:document.querySelector('[data-video-feedback]')?.dataset.videoFeedback||'idle',disabled:document.querySelector('[data-generate-video]').disabled,empty:document.querySelector('[data-video-empty]').hidden,text:document.querySelector('#status').textContent}},bundle);
   assert.equal(result.status,status);assert.equal(result.disabled,disabled);assert.equal(result.empty,empty);assert(!result.text.includes('private'));
  }
 }finally{await browser.close();}
 console.log(JSON.stringify({passed:true,cases:22,browser_transitions:6,model_calls:0}));
})().catch(e=>{console.error(e);process.exitCode=1});
