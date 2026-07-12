const path = require('path');
const { Client } = require('ssh2');
const client = new Client();
client.on('ready', () => {
  client.sftp((sftpError, sftp) => {
    if (sftpError) throw sftpError;
    const scriptName = process.env.VIDO_PROD_TEST_SCRIPT || 'prod-test-new-story-ad-scene-reference.js';
    const local = path.join(__dirname, scriptName);
    const remote = '/tmp/' + path.basename(scriptName);
    sftp.fastPut(local, remote, uploadError => {
      if (uploadError) throw uploadError;
      client.exec('cd /opt/vido/app && VIDO_APP_ROOT=/opt/vido/app NEW_STORY_AD_QA_DEBUG=1 node ' + remote, (execError, stream) => {
        if (execError) throw execError;
        let out = '';
        let err = '';
        stream.on('data', chunk => { out += chunk; });
        stream.stderr.on('data', chunk => { err += chunk; });
        stream.on('close', code => {
          if (out.trim()) console.log(out.trim());
          if (err.trim()) console.error(err.trim());
          sftp.end();
          client.end();
          if (code !== 0) process.exitCode = code || 1;
        });
      });
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({
  host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151',
  port: 22,
  username: 'root',
  password: process.env.VIDO_DEPLOY_PASSWORD,
  readyTimeout: 25000,
});
