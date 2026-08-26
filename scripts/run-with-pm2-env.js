const { execFileSync, spawnSync } = require('child_process');

const PM2_CONTROL_ENV_KEYS = new Set([
  'cwd',
  'pm_cwd',
  'pm_exec_path',
  'pm_out_log_path',
  'pm_err_log_path',
  'pm_log_path',
  'pm_pid_path',
  'exec_interpreter',
  'node_args',
  'pm_id',
  'name',
  'namespace',
]);

function scalarEnv(source = {}, excludedKeys = new Set()) {
  return Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      && !excludedKeys.has(key.toLowerCase())
      && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, String(value)]));
}

function buildPm2Env(processInfo = {}, baseEnv = process.env) {
  const pm2Env = processInfo.pm2_env || {};
  return {
    ...scalarEnv(baseEnv, PM2_CONTROL_ENV_KEYS),
    ...scalarEnv(pm2Env.env || {}, PM2_CONTROL_ENV_KEYS),
    ...scalarEnv(pm2Env, PM2_CONTROL_ENV_KEYS),
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

module.exports = { PM2_CONTROL_ENV_KEYS, scalarEnv, buildPm2Env };
