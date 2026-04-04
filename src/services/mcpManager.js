/**
 * MCP Manager — 发现、启动、管理本地 MCP 服务器子进程
 *
 * 通过 stdio JSON-RPC 2.0 与 MCP 服务器通信（MCP 协议标准传输层）。
 * 服务器启动时自动扫描 MCP/ 目录下的子项目并逐个初始化。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const MCP_ROOT = path.join(__dirname, '../../MCP');

// 运行中的 MCP 实例  { id -> McpInstance }
const instances = {};

// JSON-RPC 请求 ID 自增
let rpcId = 1;

// ============================================================
// McpInstance — 封装单个 MCP 子进程
// ============================================================
class McpInstance {
  constructor(id, name, dir, cmd, args) {
    this.id = id;
    this.name = name;
    this.dir = dir;
    this.cmd = cmd;
    this.args = args;
    this.process = null;
    this.tools = [];
    this.resources = [];
    this.status = 'stopped';       // stopped | starting | running | error
    this.error = null;
    this._pending = {};            // reqId -> { resolve, reject, timer }
    this._buffer = '';
  }

  /** 启动子进程并完成 MCP initialize 握手 */
  async start() {
    if (this.status === 'running') return;
    this.status = 'starting';
    this.error = null;

    return new Promise((resolve, reject) => {
      const env = { ...process.env, NODE_ENV: 'production' };
      this.process = spawn(this.cmd, this.args, {
        cwd: this.dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: process.platform === 'win32',
      });

      this.process.on('error', (err) => {
        this.status = 'error';
        this.error = err.message;
        console.error(`  [MCP] ${this.name} 启动失败: ${err.message}`);
        reject(err);
      });

      this.process.on('exit', (code) => {
        if (this.status === 'running') {
          console.log(`  [MCP] ${this.name} 已退出 (code ${code})`);
        }
        this.status = 'stopped';
        // reject all pending
        for (const [, p] of Object.entries(this._pending)) {
          clearTimeout(p.timer);
          p.reject(new Error('MCP process exited'));
        }
        this._pending = {};
      });

      // stderr → 日志
      this.process.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.error(`  [MCP:${this.name}] ${msg}`);
      });

      // stdout → JSON-RPC 响应解析（按行）
      const rl = readline.createInterface({ input: this.process.stdout });
      rl.on('line', (line) => this._handleLine(line));

      // 执行 initialize 握手
      this._rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vido-mcp-manager', version: '1.0.0' },
      }, 10000)
        .then(async (result) => {
          // 发送 initialized 通知
          this._notify('notifications/initialized', {});
          this.status = 'running';
          // 获取工具列表
          try { this.tools = (await this._rpc('tools/list', {}, 8000)).tools || []; } catch { this.tools = []; }
          try { this.resources = (await this._rpc('resources/list', {}, 8000)).resources || []; } catch { this.resources = []; }
          console.log(`  [MCP] ${this.name} 已启动 — ${this.tools.length} tools, ${this.resources.length} resources`);
          resolve(this);
        })
        .catch((err) => {
          this.status = 'error';
          this.error = err.message;
          this.stop();
          reject(err);
        });
    });
  }

  /** 停止子进程 */
  stop() {
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
    this.status = 'stopped';
  }

  /** 调用 MCP 工具 */
  async callTool(toolName, args = {}) {
    return this._rpc('tools/call', { name: toolName, arguments: args }, 30000);
  }

  /** 读取 MCP 资源 */
  async readResource(uri) {
    return this._rpc('resources/read', { uri }, 15000);
  }

  // ——— 内部方法 ———

  _rpc(method, params, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const id = rpcId++;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      const timer = setTimeout(() => {
        delete this._pending[id];
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout);
      this._pending[id] = { resolve, reject, timer };
      try {
        this.process.stdin.write(msg);
      } catch (e) {
        clearTimeout(timer);
        delete this._pending[id];
        reject(e);
      }
    });
  }

  _notify(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    try { this.process.stdin.write(msg); } catch {}
  }

  _handleLine(line) {
    line = line.trim();
    if (!line) return;
    try {
      const obj = JSON.parse(line);
      if (obj.id != null && this._pending[obj.id]) {
        const p = this._pending[obj.id];
        clearTimeout(p.timer);
        delete this._pending[obj.id];
        if (obj.error) {
          p.reject(new Error(obj.error.message || JSON.stringify(obj.error)));
        } else {
          p.resolve(obj.result);
        }
      }
      // notifications from server are ignored for now
    } catch {
      // non-JSON output, ignore
    }
  }
}

// ============================================================
// 发现本地 MCP 项目
// ============================================================
function discoverMCPs() {
  if (!fs.existsSync(MCP_ROOT)) return [];
  const found = [];

  for (const dir of fs.readdirSync(MCP_ROOT)) {
    const absDir = path.join(MCP_ROOT, dir);
    if (!fs.statSync(absDir).isDirectory()) continue;

    // Node.js MCP — 有 package.json
    const pkgPath = path.join(absDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const main = pkg.main || 'index.js';
        const entryPath = path.join(absDir, main);
        if (fs.existsSync(entryPath)) {
          found.push({
            id: dir,
            name: pkg.description || pkg.name || dir,
            dir: absDir,
            cmd: 'node',
            args: [entryPath],
            type: 'node',
          });
          continue;
        }
      } catch {}
    }

    // Python MCP — 有 server.py
    const pyPath = path.join(absDir, 'server.py');
    if (fs.existsSync(pyPath)) {
      found.push({
        id: dir,
        name: dir,
        dir: absDir,
        cmd: 'python',
        args: [pyPath],
        type: 'python',
      });
      continue;
    }
  }

  return found;
}

// ============================================================
// 公开 API
// ============================================================

/** 自动发现并启动所有本地 MCP */
async function startAll() {
  const mcps = discoverMCPs();
  if (mcps.length === 0) {
    console.log('  [MCP] 未发现本地 MCP 服务器');
    return;
  }

  console.log(`  [MCP] 发现 ${mcps.length} 个本地 MCP，正在启动...`);

  for (const mcp of mcps) {
    const inst = new McpInstance(mcp.id, mcp.name, mcp.dir, mcp.cmd, mcp.args);
    instances[mcp.id] = inst;
    try {
      await inst.start();
    } catch (err) {
      console.error(`  [MCP] ${mcp.name} 启动失败: ${err.message}`);
      inst.status = 'error';
      inst.error = err.message;
    }
  }
}

/** 停止所有 MCP */
function stopAll() {
  for (const inst of Object.values(instances)) {
    inst.stop();
  }
}

/** 获取所有 MCP 实例状态 */
function listInstances() {
  return Object.values(instances).map(i => ({
    id: i.id,
    name: i.name,
    status: i.status,
    error: i.error,
    tools: i.tools.map(t => ({ name: t.name, description: t.description })),
    resources: i.resources.map(r => ({ uri: r.uri, name: r.name, description: r.description })),
  }));
}

/** 获取所有可用工具（扁平列表，含 MCP 来源） */
function listAllTools() {
  const tools = [];
  for (const inst of Object.values(instances)) {
    if (inst.status !== 'running') continue;
    for (const t of inst.tools) {
      tools.push({ mcpId: inst.id, mcpName: inst.name, ...t });
    }
  }
  return tools;
}

/** 调用指定 MCP 的工具 */
async function callTool(mcpId, toolName, args) {
  const inst = instances[mcpId];
  if (!inst) throw new Error(`MCP "${mcpId}" 不存在`);
  if (inst.status !== 'running') throw new Error(`MCP "${mcpId}" 未在运行 (${inst.status})`);
  return inst.callTool(toolName, args);
}

/** 读取指定 MCP 的资源 */
async function readResource(mcpId, uri) {
  const inst = instances[mcpId];
  if (!inst) throw new Error(`MCP "${mcpId}" 不存在`);
  if (inst.status !== 'running') throw new Error(`MCP "${mcpId}" 未在运行`);
  return inst.readResource(uri);
}

/** 重启指定 MCP */
async function restartMcp(mcpId) {
  const inst = instances[mcpId];
  if (!inst) throw new Error(`MCP "${mcpId}" 不存在`);
  inst.stop();
  await inst.start();
}

module.exports = { startAll, stopAll, listInstances, listAllTools, callTool, readResource, restartMcp, discoverMCPs };
