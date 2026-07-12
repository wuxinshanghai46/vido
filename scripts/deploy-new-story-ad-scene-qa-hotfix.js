const path = require('path');
const { Client } = require('ssh2');
const client = new Client();
const local = path.resolve(__dirname, '../src/services/newStoryAd/sceneSpaceContractService.js');
const remote = '/opt/vido/app/src/services/newStoryAd/sceneSpaceContractService.js';
client.on('ready', () => {
  client.exec('cp ' + remote + ' ' + remote + '.bak-20260711-scene-qa', backupError => {
    if (backupError) throw backupError;
    client.sftp((sftpError, sftp) => {
      if (sftpError) throw sftpError;
      sftp.fastPut(local, remote, uploadError => {
        if (uploadError) throw uploadError;
        client.exec('cd /opt/vido/app && node --check src/services/newStoryAd/sceneSpaceContractService.js && pm2 reload vido --update-env >/dev/null && sleep 12 && curl -fsS http://127.0.0.1:4600/api/health >/dev/null && echo HOTFIX_OK', (execError, stream) => {
          if (execError) throw execError;
          let output = '';
          let stderr = '';
          stream.on('data', chunk => { output += chunk; });
          stream.stderr.on('data', chunk => { stderr += chunk; });
          stream.on('close', code => {
            console.log((output || stderr).trim());
            sftp.end();
            client.end();
            if (code !== 0) process.exitCode = code || 1;
          });
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
