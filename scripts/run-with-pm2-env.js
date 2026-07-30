const { execFileSync, spawnSync } = require('child_process');

function scalarEnv(source = {}) {
  return Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, String(value)]));
}

function buildPm2Env(processInfo = {}, baseEnv = process.env) {
  const pm2Env = processInfo.pm2_env || {};
  return {
    ...baseEnv,
    ...scalarEnv(pm2Env.env || {}),
    ...scalarEnv(pm2Env),
  };
}

function main(argv = process.argv.slice(2)) {
  const [appName, command, ...args] = argv;
  if (!appName || !command) {
    throw new Error('用法: node scripts/run-with-pm2-env.js <pm2应用名> <命令> [...参数]');
  }
  const list = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }) || '[]');
  const processInfo = list.find(item => item?.name === appName);
  if (!processInfo) throw new Error(`未找到 PM2 应用: ${appName}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: buildPm2Env(processInfo),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { scalarEnv, buildPm2Env };
