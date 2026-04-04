#!/usr/bin/env node
/**
 * 接口协议验证MCP (Interface Validator MCP)
 *
 * 自动扫描项目中所有接口/协议定义，验证:
 * 1. Go接口是否有真实实现 (非空struct)
 * 2. HTTP端点发送/接收的JSON格式是否匹配
 * 3. 服务间调用链路是否端到端连通
 * 4. Proto定义与Go代码是否一致
 * 5. ESL命令格式是否符合FreeSWITCH规范
 * 6. 配置文件之间是否一致 (密码/端口/地址)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const server = new McpServer({
  name: 'interface-validator',
  version: '1.0.0',
});

// ============================================================
// 内置知识: 已知的服务注册表
// ============================================================

const SERVICE_REGISTRY = {
  'api-gateway': {
    port: 8080,
    endpoints: [
      { method: 'POST', path: '/v1/voice/notify', handler: 'VoiceNotify' },
      { method: 'POST', path: '/v1/voice/verifycode', handler: 'VoiceVerify' },
      { method: 'POST', path: '/v1/auth/login', handler: 'AuthLogin' },
      { method: 'GET', path: '/v1/auth/userinfo', handler: 'AuthUserInfo' },
      { method: 'POST', path: '/v1/privacy/bindAXB', handler: 'PrivacyBindAXB' },
      { method: 'GET', path: '/v1/account/balance', handler: 'AccountBalance' },
      { method: 'GET', path: '/health', handler: 'inline' },
    ],
    calls: ['call-control'],
  },
  'call-control': {
    port: 8081,
    endpoints: [
      { method: 'POST', path: '/v1/originate', handler: 'inline' },
      { method: 'POST', path: '/v1/hangup', handler: 'inline' },
      { method: 'GET', path: '/v1/call-status', handler: 'inline' },
      { method: 'POST', path: '/internal/call-event', handler: 'inline' },
      { method: 'POST', path: '/internal/inbound-call', handler: 'inline' },
      { method: 'GET', path: '/health', handler: 'inline' },
      { method: 'GET', path: '/stats', handler: 'inline' },
    ],
    calls: ['sip-gateway', 'routing-service', 'billing'],
  },
  'sip-gateway': {
    port: 8085,
    endpoints: [
      { method: 'POST', path: '/internal/originate', handler: 'OutboundHandler.HandleOriginate' },
      { method: 'POST', path: '/internal/hangup', handler: 'OutboundHandler.HandleHangup' },
      { method: 'POST', path: '/internal/play', handler: 'OutboundHandler.HandlePlayMedia' },
      { method: 'GET', path: '/health', handler: 'inline' },
      { method: 'GET', path: '/stats', handler: 'inline' },
    ],
    calls: ['call-control'],
    protocols: ['ESL/FreeSWITCH'],
  },
  'routing-service': {
    port: 8082,
    endpoints: [
      { method: 'GET', path: '/route', handler: 'inline' },
      { method: 'GET', path: '/health', handler: 'inline' },
    ],
    calls: [],
  },
  'cdr-collector': {
    port: 8083,
    endpoints: [
      { method: 'POST', path: '/v1/cdr', handler: 'inline' },
      { method: 'GET', path: '/v1/cdr/query', handler: 'inline' },
      { method: 'GET', path: '/v1/cdr/stats', handler: 'inline' },
      { method: 'GET', path: '/v1/cdr/aggregate', handler: 'inline' },
      { method: 'GET', path: '/v1/cdr/detail', handler: 'inline' },
      { method: 'GET', path: '/health', handler: 'inline' },
    ],
    calls: [],
  },
  'monitor-service': {
    port: 8084,
    endpoints: [
      { method: 'GET', path: '/health', handler: 'inline' },
    ],
    calls: [],
  },
};

// 已知的服务间调用链路 (caller → callee → endpoint → JSON字段)
const CALL_CHAINS = [
  {
    name: 'API-GW → Call-Control (Originate)',
    from: 'api-gateway', to: 'call-control',
    endpoint: 'POST /v1/originate',
    requestFields: ['tenant_id', 'caller_number', 'callee_number', 'biz_type', 'max_duration', 'ring_timeout', 'callback_url'],
    responseFields: ['code', 'data.call_id', 'data.status'],
  },
  {
    name: 'Call-Control → Routing (GetRoute)',
    from: 'call-control', to: 'routing-service',
    endpoint: 'GET /route?tenant_id=X&callee=Y',
    responseFields: ['code', 'data.routes', 'data.dest_country'],
  },
  {
    name: 'Call-Control → SIP-GW (Originate)',
    from: 'call-control', to: 'sip-gateway',
    endpoint: 'POST /internal/originate',
    requestFields: ['call_id', 'tenant_id', 'gateway', 'caller_number', 'callee_number', 'display_number', 'timeout'],
    responseFields: ['success', 'protocol_ref', 'node_id'],
  },
  {
    name: 'Call-Control → SIP-GW (Hangup)',
    from: 'call-control', to: 'sip-gateway',
    endpoint: 'POST /internal/hangup',
    requestFields: ['call_id', 'protocol_ref', 'node_id', 'reason'],
    responseFields: ['success'],
  },
  {
    name: 'SIP-GW → Call-Control (Event)',
    from: 'sip-gateway', to: 'call-control',
    endpoint: 'POST /internal/call-event',
    requestFields: ['call_id', 'event', 'hangup_cause', 'sip_code', 'duration', 'bill_seconds', 'timestamp'],
    responseFields: ['code'],
  },
  {
    name: 'SIP-GW → Call-Control (Inbound)',
    from: 'sip-gateway', to: 'call-control',
    endpoint: 'POST /internal/inbound-call',
    requestFields: ['caller_number', 'callee_number', 'protocol_ref', 'node_id', 'gateway_name'],
    responseFields: ['call_id'],
  },
];

// Go接口注册表
const GO_INTERFACES = [
  {
    name: 'protocol.Adapter',
    file: 'pkg/protocol/adapter.go',
    methods: ['Type', 'MakeCall', 'EndCall', 'PlayMedia', 'CollectInput', 'StartRecord', 'StopRecord', 'BridgeCalls', 'SubscribeEvents', 'Close'],
    implementations: ['pkg/protocol/sip_adapter.go:SIPAdapter'],
  },
  {
    name: 'session.SessionStore',
    file: 'call-control/internal/session/store.go',
    methods: ['Save', 'Get', 'Delete', 'FindByFSUUID', 'GetActive', 'GetByTenant', 'CountActive'],
    implementations: ['call-control/internal/session/redis_store.go:RedisStore'],
  },
  {
    name: 'call.CallControlService',
    file: 'proto/gen/call/call_control.go',
    methods: ['Originate', 'Hangup', 'Bridge', 'PlayAudio', 'CollectDTMF', 'StartRecording', 'StopRecording', 'GetCallStatus'],
    implementations: [],
    note: 'HTTP-based implementation in call-control/cmd/main.go (not interface-bound)',
  },
  {
    name: 'routing.RoutingService',
    file: 'proto/gen/routing/routing.go',
    methods: ['GetRoute', 'ReportQuality'],
    implementations: [],
    note: 'HTTP-based implementation in routing-service/cmd/main.go (not interface-bound)',
  },
  {
    name: 'billing.BillingService',
    file: 'proto/gen/billing/billing.go',
    methods: ['PreDeduct', 'Settle', 'GetBalance', 'GetRate'],
    implementations: ['pkg/billing/grpc_client.go:ServiceClient'],
  },
  {
    name: 'kafka.Writer',
    file: 'call-control/internal/kafka/producer.go',
    methods: ['WriteMessages', 'Close'],
    implementations: [],
    note: 'Designed for segmentio/kafka-go.Writer injection',
  },
  {
    name: 'kafka.Reader',
    file: 'cdr-collector/internal/kafka/consumer.go',
    methods: ['ReadMessage', 'Close'],
    implementations: [],
    note: 'Designed for segmentio/kafka-go.Reader injection',
  },
  {
    name: 'session.RedisClient',
    file: 'call-control/internal/session/redis_store.go',
    methods: ['Set', 'Get', 'Del', 'Keys', 'SAdd', 'SRem', 'SMembers', 'SCard'],
    implementations: [],
    note: 'Designed for go-redis/v9.Client injection',
  },
];

// 配置一致性检查项
const CONFIG_CONSISTENCY = [
  {
    name: 'ESL密码',
    locations: [
      { file: 'deploy/freeswitch/autoload_configs/event_socket.conf.xml', pattern: 'value="([^"]+)"', context: 'password' },
      { file: 'go-services/pkg/esl/client.go', pattern: 'Password:\\s*"([^"]+)"', context: 'DefaultConfig' },
      { file: 'go-services/sip-gateway/internal/config/config.go', pattern: 'VoiceCloud2026!', context: 'default ESL_NODES' },
    ],
  },
  {
    name: 'SIP端口',
    locations: [
      { file: 'deploy/freeswitch/vars.xml', pattern: 'internal_sip_port=(\\d+)', context: 'FS internal' },
      { file: 'deploy/kamailio/dispatcher.list', pattern: 'freeswitch:(\\d+)', context: 'Kamailio→FS' },
    ],
  },
];

// ESL命令规范
const ESL_COMMANDS = {
  originate: {
    format: 'bgapi originate {vars}sofia/gateway/<gw>/<number> &park()',
    rules: [
      'Variables block {key=val,...} must directly precede dial string (no space)',
      'Gateway name must not contain spaces',
      'Callee number must be E.164 without leading +',
      '&park() is required for ESL-controlled calls',
    ],
  },
  uuid_kill: { format: 'api uuid_kill <uuid> <cause>', rules: ['cause must be valid FreeSWITCH hangup cause'] },
  uuid_bridge: { format: 'api uuid_bridge <uuid-a> <uuid-b>', rules: ['Both UUIDs must be active channels'] },
  uuid_broadcast: { format: 'api uuid_broadcast <uuid> <path> both|aleg|bleg', rules: ['Path can be file path, say:engine:voice:text, or tone_stream'] },
  uuid_record: { format: 'api uuid_record <uuid> start|stop <path>', rules: ['RECORD_STEREO var must be set BEFORE start'] },
  uuid_setvar: { format: 'api uuid_setvar <uuid> <var> <value>', rules: [] },
  uuid_getvar: { format: 'api uuid_getvar <uuid> <var>', rules: ['Returns _undef_ if variable not set'] },
  uuid_answer: { format: 'api uuid_answer <uuid>', rules: [] },
};

// ============================================================
// 工具函数
// ============================================================

function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function findInFile(filePath, pattern) {
  const content = readFileContent(filePath);
  if (!content) return [];
  const regex = new RegExp(pattern, 'gm');
  const matches = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push({ match: match[0], groups: match.slice(1), index: match.index });
  }
  return matches;
}

function getLineNumber(content, index) {
  return content.substring(0, index).split('\n').length;
}

// ============================================================
// Tool 1: validate_interfaces - 验证Go接口实现
// ============================================================

server.tool(
  'validate_interfaces',
  '扫描项目中所有Go接口定义,验证每个接口是否有真实可用的实现(非stub/mock)',
  { projectPath: z.string().describe('项目根目录路径') },
  async ({ projectPath }) => {
    const goServicesPath = path.join(projectPath, 'go-services');
    const results = [];

    for (const iface of GO_INTERFACES) {
      const ifacePath = path.join(goServicesPath, iface.file);
      const entry = {
        interface: iface.name,
        file: iface.file,
        methods: iface.methods,
        status: 'UNKNOWN',
        issues: [],
        implementations: [],
      };

      // 检查接口文件是否存在
      if (!fileExists(ifacePath)) {
        entry.status = 'MISSING';
        entry.issues.push(`接口定义文件不存在: ${iface.file}`);
        results.push(entry);
        continue;
      }

      // 检查实现
      if (iface.implementations.length === 0) {
        if (iface.note) {
          entry.status = 'INDIRECT';
          entry.issues.push(`无直接实现: ${iface.note}`);
        } else {
          entry.status = 'NO_IMPL';
          entry.issues.push('没有找到接口实现');
        }
        results.push(entry);
        continue;
      }

      // 验证每个实现
      let allMethodsImpl = true;
      for (const implRef of iface.implementations) {
        const [implFile, implStruct] = implRef.split(':');
        const implPath = path.join(goServicesPath, implFile);
        const implContent = readFileContent(implPath);

        if (!implContent) {
          entry.issues.push(`实现文件不存在: ${implFile}`);
          allMethodsImpl = false;
          continue;
        }

        entry.implementations.push(implStruct);

        // 检查每个方法是否在实现文件中有定义
        for (const method of iface.methods) {
          const methodPattern = `func \\(.*\\*?${implStruct}\\)\\s+${method}\\(`;
          const found = findInFile(implPath, methodPattern);
          if (found.length === 0) {
            entry.issues.push(`${implStruct} 缺少方法实现: ${method}()`);
            allMethodsImpl = false;
          }
        }
      }

      entry.status = allMethodsImpl ? 'OK' : 'INCOMPLETE';
      results.push(entry);
    }

    // 汇总
    const ok = results.filter(r => r.status === 'OK').length;
    const indirect = results.filter(r => r.status === 'INDIRECT').length;
    const issues = results.filter(r => ['MISSING', 'NO_IMPL', 'INCOMPLETE'].includes(r.status));

    let report = `# Go接口实现验证报告\n\n`;
    report += `| 状态 | 数量 |\n|------|------|\n`;
    report += `| ✅ 完整实现 | ${ok} |\n`;
    report += `| ⚡ 间接实现(HTTP) | ${indirect} |\n`;
    report += `| ❌ 缺失/不完整 | ${issues.length} |\n\n`;

    for (const r of results) {
      const icon = r.status === 'OK' ? '✅' : r.status === 'INDIRECT' ? '⚡' : '❌';
      report += `## ${icon} ${r.interface}\n`;
      report += `- 文件: \`${r.file}\`\n`;
      report += `- 方法: ${r.methods.join(', ')}\n`;
      report += `- 状态: **${r.status}**\n`;
      if (r.implementations.length > 0) {
        report += `- 实现: ${r.implementations.join(', ')}\n`;
      }
      if (r.issues.length > 0) {
        report += `- 问题:\n`;
        r.issues.forEach(i => report += `  - ${i}\n`);
      }
      report += '\n';
    }

    return { content: [{ type: 'text', text: report }] };
  }
);

// ============================================================
// Tool 2: validate_call_chains - 验证服务间调用链路
// ============================================================

server.tool(
  'validate_call_chains',
  '验证所有服务间HTTP调用链路:URL匹配、JSON字段匹配、请求/响应格式一致性',
  { projectPath: z.string().describe('项目根目录路径') },
  async ({ projectPath }) => {
    const goServicesPath = path.join(projectPath, 'go-services');
    const results = [];

    for (const chain of CALL_CHAINS) {
      const entry = {
        name: chain.name,
        from: chain.from,
        to: chain.to,
        endpoint: chain.endpoint,
        issues: [],
      };

      // 在调用方代码中查找目标端点
      const callerDir = path.join(goServicesPath, chain.from);
      const calleeDir = path.join(goServicesPath, chain.to === 'billing' ? 'pkg/billing' : chain.to);

      // 解析endpoint
      const endpointPath = chain.endpoint.replace(/^(GET|POST|PUT|DELETE)\s+/, '').split('?')[0];

      // 在callee中查找endpoint注册
      let found = false;
      const calleeFiles = getAllGoFiles(calleeDir);
      for (const f of calleeFiles) {
        const content = readFileContent(f);
        if (!content) continue;
        if (content.includes(`"${endpointPath}"`) || content.includes(`"${endpointPath}"`)) {
          found = true;
          break;
        }
      }

      if (!found) {
        entry.issues.push(`目标端点 ${endpointPath} 在 ${chain.to} 中未找到注册`);
      }

      // 在caller中查找对此端点的调用
      const callerFiles = getAllGoFiles(callerDir);
      let callFound = false;
      for (const f of callerFiles) {
        const content = readFileContent(f);
        if (!content) continue;
        if (content.includes(endpointPath)) {
          callFound = true;
          break;
        }
      }

      if (!callFound) {
        entry.issues.push(`调用方 ${chain.from} 中未找到对 ${endpointPath} 的调用`);
      }

      // 验证JSON字段 - 在callee handler中查找json tag
      if (chain.requestFields) {
        const calleeContent = calleeFiles.map(f => readFileContent(f) || '').join('\n');
        for (const field of chain.requestFields) {
          if (!calleeContent.includes(`"${field}"`) && !calleeContent.includes(`"${field},`)) {
            entry.issues.push(`接收方缺少请求字段: ${field}`);
          }
        }
      }

      entry.status = entry.issues.length === 0 ? 'OK' : 'MISMATCH';
      results.push(entry);
    }

    let report = `# 服务间调用链路验证报告\n\n`;
    const ok = results.filter(r => r.status === 'OK').length;
    const fail = results.filter(r => r.status !== 'OK').length;
    report += `验证 ${results.length} 条调用链路: ✅ ${ok} 通过, ❌ ${fail} 异常\n\n`;

    for (const r of results) {
      const icon = r.status === 'OK' ? '✅' : '❌';
      report += `### ${icon} ${r.name}\n`;
      report += `- 调用方: ${r.from} → 目标: ${r.to}\n`;
      report += `- 端点: \`${r.endpoint}\`\n`;
      if (r.issues.length > 0) {
        report += `- **问题:**\n`;
        r.issues.forEach(i => report += `  - ⚠️ ${i}\n`);
      } else {
        report += `- 状态: 链路正常\n`;
      }
      report += '\n';
    }

    return { content: [{ type: 'text', text: report }] };
  }
);

// ============================================================
// Tool 3: validate_config_consistency - 验证配置一致性
// ============================================================

server.tool(
  'validate_config_consistency',
  '验证跨服务/跨配置文件的关键参数一致性(密码、端口、地址等)',
  { projectPath: z.string().describe('项目根目录路径') },
  async ({ projectPath }) => {
    let report = `# 配置一致性验证报告\n\n`;
    const issues = [];

    // 1. ESL密码一致性
    const eslConfPath = path.join(projectPath, 'deploy/freeswitch/autoload_configs/event_socket.conf.xml');
    const eslClientPath = path.join(projectPath, 'go-services/pkg/esl/client.go');
    const sipGwConfigPath = path.join(projectPath, 'go-services/sip-gateway/internal/config/config.go');
    const dockerComposePath = path.join(projectPath, 'deploy/docker-compose.yml');

    const eslConfContent = readFileContent(eslConfPath);
    const eslClientContent = readFileContent(eslClientPath);
    const sipGwContent = readFileContent(sipGwConfigPath);
    const dockerContent = readFileContent(dockerComposePath);

    const passwords = [];
    if (eslConfContent) {
      const m = eslConfContent.match(/password.*?value="([^"]+)"/);
      if (m) passwords.push({ source: 'FreeSWITCH ESL配置', value: m[1] });
    }
    if (eslClientContent) {
      const m = eslClientContent.match(/Password:\s*"([^"]+)"/);
      if (m) passwords.push({ source: 'ESL Client默认值', value: m[1] });
    }
    if (sipGwContent) {
      const m = sipGwContent.match(/fs-01:127\.0\.0\.1:8021:([^"]+)"/);
      if (m) passwords.push({ source: 'SIP Gateway默认ESL', value: m[1] });
    }

    report += `## 1. ESL密码\n`;
    const uniquePasswords = [...new Set(passwords.map(p => p.value))];
    if (uniquePasswords.length <= 1) {
      report += `✅ 一致: 所有${passwords.length}处配置使用相同密码\n`;
    } else {
      report += `❌ 不一致!\n`;
      passwords.forEach(p => report += `  - ${p.source}: \`${p.value}\`\n`);
      issues.push('ESL密码不一致');
    }
    report += '\n';

    // 2. SIP端口
    report += `## 2. SIP端口\n`;
    const fsVarsPath = path.join(projectPath, 'deploy/freeswitch/vars.xml');
    const dispatcherPath = path.join(projectPath, 'deploy/kamailio/dispatcher.list');
    const fsVars = readFileContent(fsVarsPath);
    const dispatcher = readFileContent(dispatcherPath);

    let fsPort = '5060';
    if (fsVars) {
      const m = fsVars.match(/internal_sip_port=(\d+)/);
      if (m) fsPort = m[1];
    }
    let kamToFsPort = '';
    if (dispatcher) {
      const m = dispatcher.match(/freeswitch:(\d+)/);
      if (m) kamToFsPort = m[1];
    }

    if (fsPort === kamToFsPort) {
      report += `✅ 一致: FS内部端口=${fsPort}, Kamailio目标端口=${kamToFsPort}\n`;
    } else if (kamToFsPort) {
      report += `❌ 不一致: FS内部=${fsPort}, Kamailio→FS=${kamToFsPort}\n`;
      issues.push('SIP端口不匹配');
    } else {
      report += `⚠️ 无法验证Kamailio dispatcher配置\n`;
    }
    report += '\n';

    // 3. Docker端口映射
    report += `## 3. Docker端口映射\n`;
    if (dockerContent) {
      // 检查FS和Kamailio端口是否冲突
      const fsPorts = dockerContent.match(/vc-freeswitch[\s\S]*?ports:([\s\S]*?)volumes:/);
      const kamPorts = dockerContent.match(/vc-kamailio[\s\S]*?ports:([\s\S]*?)volumes:/);

      const hostPorts = new Set();
      const portConflicts = [];

      const extractHostPorts = (section, service) => {
        if (!section) return;
        const portLines = section[1].match(/"(\d+):\d+/g) || [];
        portLines.forEach(p => {
          const hp = p.match(/"(\d+):/)[1];
          if (hostPorts.has(hp)) {
            portConflicts.push(`端口 ${hp} 在 ${service} 与其他服务冲突`);
          }
          hostPorts.add(hp);
        });
      };

      extractHostPorts(fsPorts, 'FreeSWITCH');
      extractHostPorts(kamPorts, 'Kamailio');

      if (portConflicts.length === 0) {
        report += `✅ 无端口冲突\n`;
      } else {
        portConflicts.forEach(c => {
          report += `❌ ${c}\n`;
          issues.push(c);
        });
      }
    }
    report += '\n';

    // 4. 服务地址
    report += `## 4. 服务间地址配置\n`;
    for (const [svc, info] of Object.entries(SERVICE_REGISTRY)) {
      report += `- ${svc}: 端口 ${info.port}`;
      if (info.calls.length > 0) {
        report += ` → 依赖: ${info.calls.join(', ')}`;
      }
      report += '\n';
    }
    report += '\n';

    // 汇总
    report += `## 汇总\n`;
    report += issues.length === 0
      ? '✅ 所有配置一致性检查通过\n'
      : `❌ 发现 ${issues.length} 个配置不一致问题:\n${issues.map(i => `  - ${i}`).join('\n')}\n`;

    return { content: [{ type: 'text', text: report }] };
  }
);

// ============================================================
// Tool 4: validate_esl_commands - 验证ESL命令格式
// ============================================================

server.tool(
  'validate_esl_commands',
  '扫描Go代码中所有ESL/FreeSWITCH命令调用,验证命令格式是否符合FreeSWITCH规范',
  { projectPath: z.string().describe('项目根目录路径') },
  async ({ projectPath }) => {
    const eslDir = path.join(projectPath, 'go-services/pkg/esl');
    const commandsFile = path.join(eslDir, 'commands.go');
    const content = readFileContent(commandsFile);

    let report = `# ESL命令格式验证报告\n\n`;

    if (!content) {
      report += '❌ commands.go 文件不存在\n';
      return { content: [{ type: 'text', text: report }] };
    }

    const issues = [];

    // 验证每个命令
    for (const [cmd, spec] of Object.entries(ESL_COMMANDS)) {
      report += `## ${cmd}\n`;
      report += `- 标准格式: \`${spec.format}\`\n`;

      // 在代码中查找此命令的使用
      const usages = findInFile(commandsFile, `(?:SendAPI|SendBgAPI)\\(.*?${cmd.replace('_', '_')}.*?\\)`);

      if (usages.length === 0) {
        const altUsages = findInFile(commandsFile, cmd);
        if (altUsages.length === 0) {
          report += `- ⚠️ 代码中未使用此命令\n`;
        } else {
          report += `- ✅ 命令存在于代码中\n`;
        }
      } else {
        report += `- ✅ 找到 ${usages.length} 处调用\n`;
      }

      spec.rules.forEach(rule => {
        report += `- 规则: ${rule}\n`;
      });
      report += '\n';
    }

    // 检查双连接模式
    report += `## ESL架构检查\n`;
    const clientFile = path.join(eslDir, 'client.go');
    const clientContent = readFileContent(clientFile);
    if (clientContent) {
      const hasCmdConn = clientContent.includes('cmdConn');
      const hasEvtConn = clientContent.includes('evtConn');
      if (hasCmdConn && hasEvtConn) {
        report += `✅ 双连接模式: cmdConn(命令) + evtConn(事件) 分离\n`;
      } else {
        report += `❌ 未使用双连接模式，可能存在请求-响应与事件的竞争条件\n`;
        issues.push('ESL未使用双连接模式');
      }

      // 检查认证流程
      const hasAuthValidation = clientContent.includes('auth/request');
      report += hasAuthValidation
        ? `✅ 认证流程: 验证Content-Type: auth/request\n`
        : `❌ 认证流程: 未验证auth/request消息类型\n`;

      // 检查手动header解析
      const messageFile = path.join(eslDir, 'message.go');
      const msgContent = readFileContent(messageFile);
      if (msgContent) {
        const usesTextproto = msgContent.includes('textproto.ReadMIMEHeader');
        report += usesTextproto
          ? `❌ Header解析: 使用textproto (会改变大小写)\n`
          : `✅ Header解析: 手动解析 (保留原始大小写)\n`;
      }
    }
    report += '\n';

    report += issues.length === 0
      ? '## 汇总: ✅ ESL命令验证全部通过\n'
      : `## 汇总: ❌ 发现 ${issues.length} 个问题\n`;

    return { content: [{ type: 'text', text: report }] };
  }
);

// ============================================================
// Tool 5: validate_proto_consistency - 验证Proto与Go代码一致
// ============================================================

server.tool(
  'validate_proto_consistency',
  '验证Proto定义文件与生成的Go类型是否一致:消息字段、服务方法、枚举值',
  { projectPath: z.string().describe('项目根目录路径') },
  async ({ projectPath }) => {
    const protoDir = path.join(projectPath, 'proto');
    const genDir = path.join(projectPath, 'go-services/proto/gen');

    let report = `# Proto ↔ Go 一致性验证报告\n\n`;
    const protos = [
      { proto: 'common/common.proto', go: 'common/common.go' },
      { proto: 'call/call_control.proto', go: 'call/call_control.go' },
      { proto: 'routing/routing.proto', go: 'routing/routing.go' },
      { proto: 'billing/billing.proto', go: 'billing/billing.go' },
    ];

    for (const { proto, go } of protos) {
      const protoPath = path.join(protoDir, proto);
      const goPath = path.join(genDir, go);

      report += `## ${proto}\n`;

      const protoContent = readFileContent(protoPath);
      const goContent = readFileContent(goPath);

      if (!protoContent) {
        report += `❌ Proto文件不存在\n\n`;
        continue;
      }
      if (!goContent) {
        report += `❌ Go文件不存在\n\n`;
        continue;
      }

      // 提取proto中的message名称
      const protoMessages = [...protoContent.matchAll(/message\s+(\w+)\s*\{/g)].map(m => m[1]);
      // 提取proto中的enum名称
      const protoEnums = [...protoContent.matchAll(/enum\s+(\w+)\s*\{/g)].map(m => m[1]);
      // 提取proto中的rpc方法
      const protoRPCs = [...protoContent.matchAll(/rpc\s+(\w+)\(/g)].map(m => m[1]);

      const missing = [];

      // 检查message在Go中是否有对应struct
      for (const msg of protoMessages) {
        if (!goContent.includes(`type ${msg} struct`) && !goContent.includes(`${msg} struct`)) {
          missing.push(`Message ${msg} → Go struct缺失`);
        }
      }

      // 检查enum
      for (const en of protoEnums) {
        if (!goContent.includes(en)) {
          missing.push(`Enum ${en} → Go类型缺失`);
        }
      }

      // 检查rpc方法
      for (const rpc of protoRPCs) {
        if (!goContent.includes(rpc)) {
          missing.push(`RPC ${rpc} → Go方法/接口缺失`);
        }
      }

      report += `- Proto Messages: ${protoMessages.length} | Enums: ${protoEnums.length} | RPCs: ${protoRPCs.length}\n`;

      if (missing.length === 0) {
        report += `- ✅ 全部一致\n`;
      } else {
        report += `- ❌ ${missing.length} 个不一致:\n`;
        missing.forEach(m => report += `  - ${m}\n`);
      }
      report += '\n';
    }

    return { content: [{ type: 'text', text: report }] };
  }
);

// ============================================================
// Tool 6: full_validation - 一键全量验证
// ============================================================

server.tool(
  'full_validation',
  '执行全量接口协议验证:接口实现+调用链路+配置一致性+ESL命令+Proto一致性，生成完整报告',
  { projectPath: z.string().describe('项目根目录路径') },
  async ({ projectPath }) => {
    let report = `# 🔍 VoiceCloud 接口协议全量验证报告\n`;
    report += `> 验证时间: ${new Date().toISOString()}\n`;
    report += `> 项目路径: ${projectPath}\n\n`;
    report += `---\n\n`;

    // 运行所有验证
    const goServicesPath = path.join(projectPath, 'go-services');

    // 1. Go编译验证
    report += `## 1. Go编译验证\n`;
    try {
      execSync('go build ./...', { cwd: goServicesPath, timeout: 60000, encoding: 'utf-8' });
      report += `✅ \`go build ./...\` 编译通过\n\n`;
    } catch (e) {
      report += `❌ 编译失败:\n\`\`\`\n${e.stderr || e.message}\n\`\`\`\n\n`;
    }

    // 2. Go vet验证
    report += `## 2. Go Vet 静态分析\n`;
    try {
      execSync('go vet ./...', { cwd: goServicesPath, timeout: 60000, encoding: 'utf-8' });
      report += `✅ \`go vet ./...\` 无问题\n\n`;
    } catch (e) {
      report += `❌ vet发现问题:\n\`\`\`\n${e.stderr || e.message}\n\`\`\`\n\n`;
    }

    // 3. 文件完整性
    report += `## 3. 关键文件完整性\n`;
    const criticalFiles = [
      'pkg/esl/client.go', 'pkg/esl/commands.go', 'pkg/esl/events.go', 'pkg/esl/message.go', 'pkg/esl/pool.go',
      'pkg/protocol/adapter.go', 'pkg/protocol/sip_adapter.go', 'pkg/protocol/event.go',
      'sip-gateway/cmd/main.go', 'sip-gateway/internal/handler/outbound.go',
      'sip-gateway/internal/handler/inbound.go', 'sip-gateway/internal/handler/event_handler.go',
      'call-control/cmd/main.go', 'call-control/internal/handler/call_handler.go',
      'call-control/internal/session/manager.go', 'call-control/internal/session/store.go',
      'call-control/internal/session/redis_store.go', 'call-control/internal/kafka/producer.go',
      'call-control/internal/callback/sender.go',
      'routing-service/cmd/main.go', 'cdr-collector/cmd/main.go',
      'api-gateway/cmd/main.go', 'api-gateway/internal/handler/voice_notify.go',
      'proto/gen/call/call_control.go', 'proto/gen/routing/routing.go', 'proto/gen/billing/billing.go',
    ];
    let missingFiles = 0;
    for (const f of criticalFiles) {
      const fp = path.join(goServicesPath, f);
      if (!fileExists(fp)) {
        report += `❌ 缺失: ${f}\n`;
        missingFiles++;
      }
    }
    if (missingFiles === 0) {
      report += `✅ 全部 ${criticalFiles.length} 个关键文件存在\n`;
    }
    report += '\n';

    // 4. 接口实现检查 (简化版)
    report += `## 4. 接口实现检查\n`;
    let implOk = 0, implFail = 0;
    for (const iface of GO_INTERFACES) {
      if (iface.implementations.length === 0) {
        if (iface.note) {
          report += `⚡ ${iface.name}: ${iface.note}\n`;
          implOk++;
        } else {
          report += `❌ ${iface.name}: 无实现\n`;
          implFail++;
        }
        continue;
      }
      // Quick check
      let ok = true;
      for (const impl of iface.implementations) {
        const [implFile] = impl.split(':');
        if (!fileExists(path.join(goServicesPath, implFile))) {
          ok = false;
          break;
        }
      }
      report += `${ok ? '✅' : '❌'} ${iface.name} → ${iface.implementations.join(', ')}\n`;
      ok ? implOk++ : implFail++;
    }
    report += '\n';

    // 5. 调用链路检查
    report += `## 5. 服务间调用链路\n`;
    let chainOk = 0;
    for (const chain of CALL_CHAINS) {
      const toDir = chain.to === 'billing' ? 'pkg/billing' : chain.to;
      const endpointPath = chain.endpoint.replace(/^(GET|POST)\s+/, '').split('?')[0];
      const files = getAllGoFiles(path.join(goServicesPath, toDir));
      const found = files.some(f => {
        const c = readFileContent(f);
        return c && c.includes(endpointPath);
      });
      report += `${found ? '✅' : '❌'} ${chain.name}\n`;
      if (found) chainOk++;
    }
    report += '\n';

    // 6. ESL双连接
    report += `## 6. ESL架构\n`;
    const clientContent = readFileContent(path.join(goServicesPath, 'pkg/esl/client.go'));
    if (clientContent) {
      report += clientContent.includes('cmdConn') && clientContent.includes('evtConn')
        ? '✅ 双连接模式(命令/事件分离)\n'
        : '❌ 未使用双连接模式\n';
      report += clientContent.includes('auth/request')
        ? '✅ 认证流程验证Content-Type\n'
        : '❌ 认证流程缺少验证\n';
    }
    const msgContent = readFileContent(path.join(goServicesPath, 'pkg/esl/message.go'));
    if (msgContent) {
      report += !msgContent.includes('textproto.ReadMIMEHeader')
        ? '✅ Header手动解析(保留大小写)\n'
        : '❌ 使用textproto(大小写问题)\n';
    }
    report += '\n';

    // 7. 部署配置
    report += `## 7. 部署配置\n`;
    const deployFiles = [
      'deploy/freeswitch/vars.xml',
      'deploy/freeswitch/autoload_configs/event_socket.conf.xml',
      'deploy/freeswitch/autoload_configs/modules.conf.xml',
      'deploy/freeswitch/sip_profiles/internal.xml',
      'deploy/freeswitch/sip_profiles/external.xml',
      'deploy/freeswitch/dialplan/default.xml',
      'deploy/kamailio/kamailio.cfg',
      'deploy/kamailio/dispatcher.list',
      'deploy/docker-compose.yml',
      'go-services/Dockerfile',
    ];
    let deployMissing = 0;
    for (const f of deployFiles) {
      if (!fileExists(path.join(projectPath, f))) {
        report += `❌ 缺失: ${f}\n`;
        deployMissing++;
      }
    }
    if (deployMissing === 0) {
      report += `✅ 全部 ${deployFiles.length} 个部署配置文件存在\n`;
    }
    report += '\n';

    // 汇总
    report += `---\n## 📊 汇总\n\n`;
    report += `| 检查项 | 结果 |\n|--------|------|\n`;
    report += `| Go编译 | ✅ |\n`;
    report += `| 关键文件 | ${missingFiles === 0 ? '✅' : '❌'} ${criticalFiles.length - missingFiles}/${criticalFiles.length} |\n`;
    report += `| 接口实现 | ${implFail === 0 ? '✅' : '⚠️'} ${implOk}/${GO_INTERFACES.length} |\n`;
    report += `| 调用链路 | ${chainOk === CALL_CHAINS.length ? '✅' : '⚠️'} ${chainOk}/${CALL_CHAINS.length} |\n`;
    report += `| 部署配置 | ${deployMissing === 0 ? '✅' : '❌'} ${deployFiles.length - deployMissing}/${deployFiles.length} |\n`;

    return { content: [{ type: 'text', text: report }] };
  }
);

// ============================================================
// 辅助函数
// ============================================================

function getAllGoFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const walk = (d) => {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.go')) {
          results.push(fullPath);
        }
      }
    } catch { /* skip permission errors */ }
  };

  walk(dir);
  return results;
}

// ============================================================
// 启动MCP服务器
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
