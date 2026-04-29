// 直接调阿里 WebSocket 试 voice + model 组合，找到生产可用的
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `cd /opt/vido/app && node -e "
    const aliyun = require('./src/services/aliyunVoiceService');
    const path = require('path');
    const tests = [
      { model: 'cosyvoice-v3-flash', voice: 'longxiaochun' },
      { model: 'cosyvoice-v3-flash', voice: 'longjing' },
      { model: 'cosyvoice-v3-flash', voice: 'longwan_v2' },
      { model: 'cosyvoice-v3-flash', voice: 'longjingjing_v2' },
      { model: 'cosyvoice-v3-flash', voice: 'longstella' },
      { model: 'cosyvoice-v3-flash', voice: 'longxiaochun_v3' },
      { model: 'cosyvoice-v3-flash', voice: 'longshu_v2' },
      { model: 'cosyvoice-v3-flash', voice: 'longcheng_v2' },
      { model: 'cosyvoice-v3-flash', voice: 'longcheng' },
      { model: 'cosyvoice-v3-flash', voice: 'longhua' },
    ];
    (async () => {
      for (const t of tests) {
        try {
          const out = '/tmp/test_' + t.voice + '.mp3';
          await aliyun.synthesize('测试', t.voice, out, { model: t.model });
          console.log('✓', t.model, '+', t.voice, '→ OK');
        } catch (e) {
          console.log('✗', t.model, '+', t.voice, '→', e.message);
        }
      }
    })();
  "`;
  c.exec(cmd, (e, s) => { if (e) {console.log(e); c.end(); return;} s.on('data', d => process.stdout.write(d.toString())); s.stderr.on('data', d => process.stderr.write(d.toString())); s.on('close', () => c.end()); });
}).on('error', e => console.log('ERR', e.message));
c.connect({host:'43.98.167.151',port:22,username:'root',password:process.argv[2]});
