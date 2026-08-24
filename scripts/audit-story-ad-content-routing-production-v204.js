'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/current';

function quote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }

function command({ apply = false } = {}) {
  if (apply) return `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node scripts/configure-story-ad-webang-content-routing-v204.js --apply`;
  const source = `
    const settings=require('./src/services/settingsService').loadSettings();
    const pipeline=require('./src/services/pipelineModelService');
    const provider=(settings.providers||[]).find(item=>[item.id,item.preset].some(value=>String(value||'').toLowerCase()==='webang-maas'));
    const wanted=['gpt-5.6-terra','gpt-5.6-luna','gemini-2.5-flash'];
    const stages=['new_story_ad.brief_dialogue','new_story_ad.assist','new_story_ad.scene_config','new_story_ad.blueprint','new_story_ad.storyboard_table','new_story_ad.qa','new_story_ad.reference_video_vision','new_story_ad.reference_video_synthesis'];
    console.log(JSON.stringify({applied:false,stage_count:stages.length,provider:{present:!!provider,enabled:provider?.enabled!==false,api_key_present:!!String(provider?.api_key||'').trim(),models:Object.fromEntries(wanted.map(id=>{const model=(provider?.models||[]).find(item=>item.id===id);return [id,{present:!!model,enabled:model?.enabled!==false}]}))},stages:Object.fromEntries(stages.map(stage=>[stage,pipeline.pickAllEnabled(stage).map(item=>item.provider_id+'/'+item.model_id)]))}));`;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  const evaluation = `eval(Buffer.from('${encoded}','base64').toString('utf8'))`;
  return `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(evaluation)}`;
}

function main() {
  const apply = process.argv.includes('--apply');
  const client = new Client();
  client.on('ready', () => client.exec(command({ apply }), (error, stream) => {
    if (error) throw error;
    let stdout = '', stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      client.end();
      if (code) {
        console.error(stderr.trim() || stdout.trim() || `remote audit exited ${code}`);
        process.exitCode = 1;
        return;
      }
      const result = JSON.parse(stdout.trim());
      if (result.applied !== apply || !Number(result.stage_count)) throw new Error('INVALID_WEBANG_CONTENT_ROUTING_AUDIT');
      console.log(JSON.stringify(result));
    });
  })).on('error', error => {
    console.error(error.message || error);
    process.exitCode = 1;
  }).connect(connectionOptions({ host, port, username }));
}

if (require.main === module) main();
module.exports = { command };
