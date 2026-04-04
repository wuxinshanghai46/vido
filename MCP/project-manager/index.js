#!/usr/bin/env node
/**
 * 项目管理MCP (Project Manager MCP)
 *
 * 封装全栈SaaS平台开发的分工策略与流程模板，
 * 基于VoiceCloud项目实战经验提炼，可复用于其他项目。
 *
 * 核心能力:
 * 1. 竞品分析驱动的需求生成
 * 2. 分阶段开发策略(数据库→Store→路由→页面→测试→文档)
 * 3. 并行任务分配与依赖管理
 * 4. 全栈变更级联追踪
 * 5. 文档三件套自动生成(架构/PRD/操作手册)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'project-manager',
  version: '1.0.0',
});

// ============================================================
// 内置知识: 开发分工策略模板
// ============================================================

const PHASE_TEMPLATES = {
  core: {
    name: '核心功能阶段',
    description: '数据库+前端+文档的全栈开发流程',
    steps: [
      { id: 'S1', name: '竞品/需求分析', parallel: false, desc: '分析竞品文档(如VOS3000)，识别差距，生成优化点清单' },
      { id: 'S2', name: '数据库DDL优化', parallel: false, desc: '新增/修改表结构，添加初始数据和权限，更新ER图注释' },
      { id: 'S3', name: 'Store数据层', parallel: true, group: 'frontend', desc: '新增mock数据ref和CRUD方法，导出到return' },
      { id: 'S4', name: '路由+导航', parallel: true, group: 'frontend', desc: '添加路由条目和侧边栏菜单项+搜索索引' },
      { id: 'S5', name: '新增页面开发', parallel: true, group: 'pages', desc: '创建Vue页面组件，按模块并行开发' },
      { id: 'S6', name: '现有页面集成', parallel: true, group: 'pages', desc: '在现有页面中关联新功能' },
      { id: 'S7', name: '构建测试', parallel: false, desc: '运行npm run build验证0错误' },
      { id: 'S8', name: '架构文档升级', parallel: true, group: 'docs', desc: '更新架构设计文档' },
      { id: 'S9', name: '产品需求文档', parallel: true, group: 'docs', desc: '编写PRD(用户故事/业务规则/验收标准)' },
      { id: 'S10', name: '操作手册', parallel: true, group: 'docs', desc: '编写操作手册(操作入口→表格说明→步骤→窍门)' },
      { id: 'S11', name: '会话日志', parallel: false, desc: '记录工作内容到日志文件' },
    ],
    parallelGroups: {
      frontend: 'S3和S4可并行(无依赖)',
      pages: 'S5和S6可并行(按功能模块拆分为多个Agent)',
      docs: 'S8/S9/S10可并行(三份文档互不依赖)',
    },
    dependencies: [
      'S2 → S3 (数据库字段确定后才能写Store)',
      'S3+S4 → S5 (Store和路由就绪后才能开发页面)',
      'S5 → S7 (页面完成后才能构建测试)',
      'S7 → S8+S9+S10 (测试通过后才写文档)',
    ],
  },
  advanced: {
    name: '高级功能阶段',
    description: '在核心功能基础上追加高级运维/分析能力',
    steps: [
      { id: 'A1', name: '数据库DDL追加', parallel: false, desc: '新增高级功能表，添加权限和初始数据' },
      { id: 'A2', name: 'Store+路由+导航', parallel: true, group: 'infra', desc: '一个Agent同时处理Store/路由/导航更新' },
      { id: 'A3', name: '新页面开发', parallel: true, group: 'pages', desc: '按功能模块分配多个Agent并行开发' },
      { id: 'A4', name: '构建测试', parallel: false, desc: 'npm run build验证' },
      { id: 'A5', name: '文档追加', parallel: true, group: 'docs', desc: '三份文档同时追加Phase2内容' },
      { id: 'A6', name: '完整性审计', parallel: false, desc: '交叉验证: 文件↔路由↔菜单↔Store全匹配' },
    ],
  },
};

const CASCADE_CHAIN = {
  description: '全栈变更级联链: 一个功能需求触发的完整变更路径',
  chain: [
    { layer: '数据库', file: 'scripts/db/init.sql', actions: ['CREATE TABLE', 'ALTER TABLE', 'INSERT权限', 'INSERT初始数据', 'ER注释'] },
    { layer: 'Store', file: 'web/src/stores/index.js', actions: ['ref([])', 'CRUD函数', 'return导出'] },
    { layer: '路由', file: 'web/src/router/index.js', actions: ['path+component+meta'] },
    { layer: '导航', file: 'web/src/components/layout/AppLayout.vue', actions: ['el-menu-item', 'allModules搜索索引'] },
    { layer: '页面', file: 'web/src/views/{module}/{Page}.vue', actions: ['script setup', 'useStore()', 'el-table/form/dialog'] },
    { layer: '测试', file: 'npm run build', actions: ['0 errors'] },
    { layer: '架构文档', file: '.claude/plans/*.md', actions: ['架构概述', '技术实现', '数据表'] },
    { layer: 'PRD', file: 'docs/product-requirements-*.md', actions: ['用户故事', '业务规则', '验收标准'] },
    { layer: '操作手册', file: 'docs/operation-manual-*.md', actions: ['操作入口→表格说明→步骤→窍门'] },
  ],
};

const PAGE_TEMPLATE = {
  description: 'Vue页面标准结构模板(Element Plus + Pinia)',
  sections: [
    'Stats Cards - 顶部统计卡片(el-row > el-col > el-card)',
    'Filter Bar - 筛选栏(el-input + el-select + el-date-picker + el-button)',
    'Data Table - 主表格(el-table border stripe > el-table-column)',
    'Dialog Form - 新建/编辑弹窗(el-dialog > el-form > el-form-item)',
    'Action Handlers - 操作函数(add/update/delete + ElMessage/ElMessageBox)',
  ],
  patterns: {
    store: "import { useStore } from '@/stores'\nconst store = useStore()",
    statsCard: '<el-card shadow="never"><div class="stat-value">{{ value }}</div><div class="stat-label">标签</div></el-card>',
    statusTag: '<el-tag :type="statusMap[row.status]">{{ statusLabel[row.status] }}</el-tag>',
    confirmDelete: "ElMessageBox.confirm('确认删除?','提示',{type:'warning'}).then(()=>{...})",
  },
};

const DOC_TEMPLATES = {
  architecture: {
    name: '架构设计文档模板',
    structure: [
      '## N.M 模块名称',
      '- **架构概述**: 一句话描述',
      '- **核心流程**: 编号步骤',
      '- **技术实现**: 具体方案(Redis/Kafka/gRPC等)',
      '- **数据表**: t_xxx',
    ],
  },
  prd: {
    name: '产品需求文档模板',
    structure: [
      '### N.M 功能名称',
      '#### 用户故事 - 作为X，我需要Y，以便Z',
      '#### 功能描述 - 要点列表',
      '#### 业务规则 - 编号规则+公式',
      '#### 界面 - 操作入口/页面/数据表',
      '#### 验收标准 - [ ] checklist',
    ],
  },
  manual: {
    name: '操作手册模板(VOS3000风格)',
    structure: [
      '### N.M 功能名称',
      '#### 操作入口 - 导航路径',
      '#### 功能概述 - 一段话描述',
      '#### 表格说明 - |字段|说明| 表格',
      '#### 操作步骤 - **步骤N** 具体操作',
      '> **说明/注意/窍门**: 补充信息框',
    ],
  },
};

const PARALLEL_STRATEGY = {
  description: '并行任务分配策略',
  rules: [
    '同层级无依赖的任务用多个Agent并行执行',
    'Store+路由+导航可合并为1个Agent(文件少，变更集中)',
    '页面开发按功能模块分为2-3个Agent(每个Agent负责2-3个页面)',
    '三份文档各分配1个Agent并行(架构/PRD/操作手册)',
    '数据库DDL和构建测试必须串行(有依赖)',
    '文档Agent可用run_in_background后台执行',
  ],
  agentSplit: {
    '3页面项目': '1 Agent: Store+路由+导航, 1 Agent: 3个页面, 1 Agent: 文档',
    '5页面项目': '1 Agent: Store+路由+导航, 2 Agent: 页面(3+2), 3 Agent: 文档(并行)',
    '8页面项目': '1 Agent: Store+路由+导航, 3 Agent: 页面(3+3+2), 3 Agent: 文档(并行)',
    '10+页面项目': '1 Agent: Store+路由, 1 Agent: 导航, 4 Agent: 页面, 3 Agent: 文档',
  },
};

const AUDIT_CHECKLIST = {
  description: '完整性审计清单',
  checks: [
    { item: '路由↔文件', method: '每条路由的component指向的.vue文件必须存在' },
    { item: '菜单↔路由', method: '每个el-menu-item的index必须在router中有对应path' },
    { item: 'Store↔页面', method: '页面import的store数据必须在return中导出' },
    { item: '数据库↔Store', method: 'DDL新增的表必须在Store中有对应mock数据' },
    { item: '权限↔功能', method: '新增功能必须有对应的permission记录' },
    { item: '构建验证', method: 'npm run build必须0 error' },
    { item: '文档覆盖', method: '每个新功能必须在架构/PRD/操作手册中都有章节' },
    { item: '搜索索引', method: 'AppLayout的allModules数组包含所有新页面' },
  ],
};

// ============================================================
// MCP Tools
// ============================================================

// Tool 1: 生成开发计划
server.tool(
  'generate_dev_plan',
  '根据功能需求清单，生成分阶段开发计划(任务分解+依赖+并行策略+Agent分配)',
  {
    features: z.array(z.object({
      name: z.string().describe('功能名称'),
      module: z.string().describe('所属模块(finance/operations/system等)'),
      complexity: z.enum(['simple', 'medium', 'complex']).describe('复杂度'),
      needsNewTable: z.boolean().describe('是否需要新建数据库表'),
      needsNewPage: z.boolean().describe('是否需要新建前端页面'),
    })).describe('功能需求列表'),
    phase: z.enum(['core', 'advanced']).default('core').describe('开发阶段'),
    projectType: z.enum(['saas', 'admin', 'mobile', 'api']).default('saas').describe('项目类型'),
  },
  async ({ features, phase, projectType }) => {
    const template = PHASE_TEMPLATES[phase];
    const newTables = features.filter(f => f.needsNewTable).length;
    const newPages = features.filter(f => f.needsNewPage).length;

    // 计算Agent分配
    let agentPlan;
    if (newPages <= 3) agentPlan = PARALLEL_STRATEGY.agentSplit['3页面项目'];
    else if (newPages <= 5) agentPlan = PARALLEL_STRATEGY.agentSplit['5页面项目'];
    else if (newPages <= 8) agentPlan = PARALLEL_STRATEGY.agentSplit['8页面项目'];
    else agentPlan = PARALLEL_STRATEGY.agentSplit['10+页面项目'];

    const plan = {
      phase: template.name,
      summary: `${features.length}个功能, ${newTables}张新表, ${newPages}个新页面`,
      agentAllocation: agentPlan,
      steps: template.steps.map(s => ({
        ...s,
        featureMapping: s.id === 'S2' || s.id === 'A1'
          ? features.filter(f => f.needsNewTable).map(f => f.name)
          : s.id === 'S5' || s.id === 'A3'
          ? features.filter(f => f.needsNewPage).map(f => `${f.module}/${f.name}`)
          : undefined,
      })),
      dependencies: template.dependencies || [],
      parallelGroups: template.parallelGroups || {},
      cascadeChain: CASCADE_CHAIN.chain.map(c => `${c.layer}: ${c.file}`),
    };

    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
  }
);

// Tool 2: 获取级联变更清单
server.tool(
  'get_cascade_changes',
  '输入一个功能名称，输出该功能在全栈各层需要的变更清单',
  {
    featureName: z.string().describe('功能名称(如: 双边对账/套餐管理)'),
    module: z.string().describe('所属模块(如: finance/operations/ops-mgmt/system)'),
    pageName: z.string().describe('Vue页面文件名(如: BilateralRecon)'),
    tableName: z.string().optional().describe('数据库表名(如: t_bilateral_reconciliation)'),
    hasDialog: z.boolean().default(true).describe('页面是否包含新建/编辑弹窗'),
    hasTabs: z.boolean().default(false).describe('页面是否包含标签页'),
    hasChart: z.boolean().default(false).describe('页面是否包含图表'),
  },
  async ({ featureName, module, pageName, tableName, hasDialog, hasTabs, hasChart }) => {
    const routePath = `/${module}/${pageName.replace(/([A-Z])/g, '-$1').toLowerCase().slice(1)}`;

    const changes = {
      feature: featureName,
      totalFiles: 5 + (tableName ? 1 : 0),
      cascade: [
        tableName ? {
          layer: '1. 数据库 DDL',
          file: 'scripts/db/init.sql',
          actions: [
            `CREATE TABLE ${tableName} (...)`,
            `INSERT INTO t_permission (...) -- 新增权限`,
            `-- 更新ER图注释`,
          ],
        } : null,
        {
          layer: '2. Store 数据层',
          file: 'web/src/stores/index.js',
          actions: [
            `const ${pageName.charAt(0).toLowerCase() + pageName.slice(1)}s = ref([...]) // mock数据`,
            `const add${pageName} = (data) => { ... }`,
            `const update${pageName} = (id, data) => { ... }`,
            `const delete${pageName} = (id) => { ... }`,
            `// 添加到 return { ... }`,
          ],
        },
        {
          layer: '3. 路由',
          file: 'web/src/router/index.js',
          actions: [
            `{ path: '${routePath}', name: '${pageName}', component: () => import('../views/${module}/${pageName}.vue'), meta: { title: '${featureName}' } }`,
          ],
        },
        {
          layer: '4. 导航菜单',
          file: 'web/src/components/layout/AppLayout.vue',
          actions: [
            `<el-menu-item index="${routePath}">${featureName}</el-menu-item>`,
            `{ name: '${featureName}', path: '${routePath}', group: '模块名', icon: 'IconName' } // allModules搜索`,
          ],
        },
        {
          layer: '5. 页面组件',
          file: `web/src/views/${module}/${pageName}.vue`,
          actions: [
            'Stats Cards 统计卡片',
            'Filter Bar 筛选栏',
            `el-table 数据表格`,
            hasTabs ? 'el-tabs 标签页切换' : null,
            hasDialog ? 'el-dialog 新建/编辑弹窗' : null,
            hasChart ? 'Chart 图表占位(ECharts)' : null,
          ].filter(Boolean),
        },
      ].filter(Boolean),
      documents: [
        { doc: '架构文档', section: `## N.M ${featureName}`, content: '架构概述/核心流程/技术实现/数据表' },
        { doc: 'PRD', section: `### N.M ${featureName}`, content: '用户故事/功能描述/业务规则/验收标准' },
        { doc: '操作手册', section: `### N.M ${featureName}`, content: '操作入口/表格说明/操作步骤/说明窍门' },
      ],
    };

    return { content: [{ type: 'text', text: JSON.stringify(changes, null, 2) }] };
  }
);

// Tool 3: 生成页面代码模板
server.tool(
  'generate_page_template',
  '生成Vue 3 + Element Plus页面的代码骨架',
  {
    pageName: z.string().describe('页面组件名称(PascalCase)'),
    title: z.string().describe('页面中文标题'),
    storeDataName: z.string().describe('Store中的数据名(如: trunkGroups)'),
    columns: z.array(z.object({
      prop: z.string(),
      label: z.string(),
      type: z.enum(['text', 'tag', 'progress', 'time', 'number', 'action']).default('text'),
    })).describe('表格列定义'),
    statsCards: z.array(z.object({
      label: z.string(),
      value: z.string().describe('computed表达式或固定值'),
      color: z.string().default('#409EFF'),
    })).optional().describe('统计卡片'),
    hasTabs: z.boolean().default(false),
    hasDialog: z.boolean().default(true),
  },
  async ({ pageName, title, storeDataName, columns, statsCards, hasTabs, hasDialog }) => {
    const cols = columns.map(c => {
      if (c.type === 'tag') return `        <el-table-column prop="${c.prop}" label="${c.label}" width="100"><template #default="{row}"><el-tag>{{ row.${c.prop} }}</el-tag></template></el-table-column>`;
      if (c.type === 'action') return `        <el-table-column label="操作" width="160" fixed="right"><template #default="{row}"><el-button size="small" @click="onEdit(row)">编辑</el-button><el-button size="small" type="danger" @click="onDelete(row)">删除</el-button></template></el-table-column>`;
      return `        <el-table-column prop="${c.prop}" label="${c.label}" />`;
    }).join('\n');

    const statsHtml = (statsCards || []).map((s, i) =>
      `      <el-col :span="6">\n        <el-card shadow="never"><div style="font-size:24px;font-weight:700;color:${s.color}">{{ ${s.value} }}</div><div style="color:#909399;margin-top:4px">${s.label}</div></el-card>\n      </el-col>`
    ).join('\n');

    const template = `<template>
  <div style="padding:20px">
    ${statsCards ? `<el-row :gutter="16" style="margin-bottom:20px">\n${statsHtml}\n    </el-row>` : ''}
    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span style="font-size:16px;font-weight:600">${title}</span>
        <el-button type="primary" @click="dialogVisible = true">新建</el-button>
      </div>
      <el-table :data="store.${storeDataName}" border stripe>
${cols}
      </el-table>
    </el-card>
    ${hasDialog ? `<el-dialog v-model="dialogVisible" title="新建${title}" width="600" destroy-on-close>\n      <el-form :model="form" label-width="100px">\n        <!-- TODO: 表单字段 -->\n      </el-form>\n      <template #footer>\n        <el-button @click="dialogVisible = false">取消</el-button>\n        <el-button type="primary" @click="onSubmit">确定</el-button>\n      </template>\n    </el-dialog>` : ''}
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useStore } from '@/stores'
import { ElMessage, ElMessageBox } from 'element-plus'

const store = useStore()
const dialogVisible = ref(false)
const form = ref({})

const onEdit = (row) => { form.value = { ...row }; dialogVisible.value = true }
const onDelete = (row) => {
  ElMessageBox.confirm('确认删除?', '提示', { type: 'warning' }).then(() => {
    store.delete${pageName}(row.id)
    ElMessage.success('已删除')
  })
}
const onSubmit = () => {
  if (form.value.id) {
    store.update${pageName}(form.value.id, form.value)
    ElMessage.success('已更新')
  } else {
    store.add${pageName}(form.value)
    ElMessage.success('已创建')
  }
  dialogVisible.value = false
}
</script>`;

    return { content: [{ type: 'text', text: template }] };
  }
);

// Tool 4: 生成审计报告
server.tool(
  'audit_completeness',
  '输入项目路径，生成完整性审计检查清单(路由↔文件↔菜单↔Store)',
  {
    projectPath: z.string().describe('项目根路径'),
    viewsDir: z.string().default('web/src/views').describe('Vue页面目录'),
    routerFile: z.string().default('web/src/router/index.js'),
    layoutFile: z.string().default('web/src/components/layout/AppLayout.vue'),
    storeFile: z.string().default('web/src/stores/index.js'),
  },
  async ({ projectPath }) => {
    const report = {
      checklist: AUDIT_CHECKLIST.checks,
      commands: {
        listVueFiles: `find ${projectPath}/web/src/views -name "*.vue" | wc -l`,
        listRoutes: `grep -c "path:" ${projectPath}/web/src/router/index.js`,
        listMenuItems: `grep -c 'el-menu-item index=' ${projectPath}/web/src/components/layout/AppLayout.vue`,
        buildTest: `cd ${projectPath}/web && npm run build 2>&1 | grep -E "(error|✓ built)"`,
        crossCheck: `# 使用Explore Agent交叉验证: 列出所有.vue文件/路由/菜单项，检查一致性`,
      },
      expectedMatches: '路由数 ≈ 菜单项数 ≈ Vue文件数(±1-2，因为Login页无菜单)',
    };
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  }
);

// Tool 5: 获取文档模板
server.tool(
  'get_doc_template',
  '获取指定类型的文档模板(架构设计/PRD/操作手册)',
  {
    docType: z.enum(['architecture', 'prd', 'manual']).describe('文档类型'),
    featureName: z.string().describe('功能名称'),
    sectionNumber: z.string().default('N.M').describe('章节编号'),
  },
  async ({ docType, featureName, sectionNumber }) => {
    const tmpl = DOC_TEMPLATES[docType];
    const filled = tmpl.structure.map(line =>
      line.replace('N.M', sectionNumber).replace('功能名称', featureName)
    ).join('\n');

    return { content: [{ type: 'text', text: `# ${tmpl.name}\n\n${filled}\n\n---\n完整模板结构参考:\n${JSON.stringify(tmpl, null, 2)}` }] };
  }
);

// Tool 6: 获取并行策略建议
server.tool(
  'get_parallel_strategy',
  '根据任务数量和类型，推荐最优的并行Agent分配策略',
  {
    totalPages: z.number().describe('需要创建的新页面数'),
    totalTables: z.number().describe('需要创建的新数据库表数'),
    hasDocUpdate: z.boolean().default(true).describe('是否需要更新文档'),
  },
  async ({ totalPages, totalTables, hasDocUpdate }) => {
    const strategy = {
      totalAgentsNeeded: 0,
      phases: [],
    };

    // Phase 1: 串行 - 数据库
    strategy.phases.push({
      phase: '串行阶段1',
      tasks: [`数据库DDL (${totalTables}张表) - 主进程直接执行`],
      agents: 0,
    });

    // Phase 2: 并行 - Store+路由+页面
    const storeAgent = 1;
    const pageAgents = totalPages <= 3 ? 1 : totalPages <= 6 ? 2 : totalPages <= 10 ? 3 : 4;
    strategy.phases.push({
      phase: '并行阶段2',
      tasks: [
        `Agent A: Store + 路由 + 导航 (3个文件)`,
        ...Array.from({ length: pageAgents }, (_, i) => {
          const start = Math.floor(i * totalPages / pageAgents);
          const end = Math.floor((i + 1) * totalPages / pageAgents);
          return `Agent ${String.fromCharCode(66 + i)}: 页面开发 (${end - start}个页面)`;
        }),
      ],
      agents: storeAgent + pageAgents,
    });

    // Phase 3: 串行 - 构建测试
    strategy.phases.push({
      phase: '串行阶段3',
      tasks: ['npm run build 构建验证 - 主进程执行'],
      agents: 0,
    });

    // Phase 4: 并行 - 文档
    if (hasDocUpdate) {
      strategy.phases.push({
        phase: '并行阶段4 (后台)',
        tasks: [
          'Agent: 架构文档升级 (run_in_background)',
          'Agent: PRD更新 (run_in_background)',
          'Agent: 操作手册更新 (run_in_background)',
        ],
        agents: 3,
      });
    }

    strategy.totalAgentsNeeded = strategy.phases.reduce((sum, p) => sum + p.agents, 0);
    strategy.estimatedSpeedup = `约${Math.round(strategy.totalAgentsNeeded * 0.6)}x (并行效率~60%)`;

    return { content: [{ type: 'text', text: JSON.stringify(strategy, null, 2) }] };
  }
);

// Tool 7: 获取全栈开发规范
server.tool(
  'get_dev_standards',
  '获取项目开发规范和最佳实践(命名/结构/模式)',
  {
    aspect: z.enum(['naming', 'database', 'store', 'page', 'router', 'docs', 'all']).describe('规范方面'),
  },
  async ({ aspect }) => {
    const standards = {
      naming: {
        database: '表名: t_模块_实体 (如 t_trunk_group), 字段: snake_case, 索引: idx_/uk_前缀',
        store: 'ref名: camelCase复数 (如 trunkGroups), CRUD: add/update/delete+PascalCase',
        page: '文件: PascalCase.vue (如 TrunkGroup.vue), 路由path: kebab-case (/trunk-groups)',
        router: 'name: PascalCase (TrunkGroup), meta.title: 中文标题',
      },
      database: {
        tableStructure: 'id(BIGINT PK AUTO_INCREMENT) + 业务ID(VARCHAR UNIQUE) + 业务字段 + status + created_at + updated_at',
        comments: '每个字段COMMENT, 每个表COMMENT, ER图注释',
        foreignKeys: '逻辑关联注释, 分表场景不加物理FK',
        initialData: '权限INSERT, 示例数据INSERT',
        versionTag: '-- v3.0/Phase2 注释标注变更来源',
      },
      store: {
        pattern: 'defineStore("main", () => { const data = ref([...]); const addX = ...; return { data, addX } })',
        mockData: '3-5条真实业务数据, 字段与DDL一一对应',
        crud: 'add(push) / update(findIndex+Object.assign) / delete(filter)',
      },
      page: {
        structure: 'Stats Cards → Filter Bar → el-table → el-dialog',
        imports: "import { useStore } from '@/stores'; import { ElMessage, ElMessageBox } from 'element-plus'",
        style: 'el-card shadow="never", el-table border stripe, inline styles优先',
        lines: '150-300行/页面',
      },
      router: {
        pattern: '{ path, name, component: () => import("..."), meta: { title } }',
        grouping: '按模块分组注释: // Voice / Numbers / Finance / Operations / System / Developer',
      },
      docs: {
        architecture: '架构概述 + 核心流程 + 技术实现 + 数据表',
        prd: '用户故事 + 功能描述 + 业务规则 + 验收标准',
        manual: '操作入口 → 表格说明 → 操作步骤 → 说明/窍门框 (VOS3000风格)',
      },
    };

    const result = aspect === 'all' ? standards : { [aspect]: standards[aspect] };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================
// Resources: 可查阅的知识库
// ============================================================

server.resource(
  'strategy://phase-templates',
  'project-manager://strategy/phase-templates',
  async () => ({
    contents: [{
      uri: 'project-manager://strategy/phase-templates',
      mimeType: 'application/json',
      text: JSON.stringify(PHASE_TEMPLATES, null, 2),
    }],
  })
);

server.resource(
  'strategy://cascade-chain',
  'project-manager://strategy/cascade-chain',
  async () => ({
    contents: [{
      uri: 'project-manager://strategy/cascade-chain',
      mimeType: 'application/json',
      text: JSON.stringify(CASCADE_CHAIN, null, 2),
    }],
  })
);

server.resource(
  'strategy://parallel-rules',
  'project-manager://strategy/parallel-rules',
  async () => ({
    contents: [{
      uri: 'project-manager://strategy/parallel-rules',
      mimeType: 'application/json',
      text: JSON.stringify(PARALLEL_STRATEGY, null, 2),
    }],
  })
);

server.resource(
  'strategy://audit-checklist',
  'project-manager://strategy/audit-checklist',
  async () => ({
    contents: [{
      uri: 'project-manager://strategy/audit-checklist',
      mimeType: 'application/json',
      text: JSON.stringify(AUDIT_CHECKLIST, null, 2),
    }],
  })
);

server.resource(
  'templates://page',
  'project-manager://templates/page',
  async () => ({
    contents: [{
      uri: 'project-manager://templates/page',
      mimeType: 'application/json',
      text: JSON.stringify(PAGE_TEMPLATE, null, 2),
    }],
  })
);

server.resource(
  'templates://docs',
  'project-manager://templates/docs',
  async () => ({
    contents: [{
      uri: 'project-manager://templates/docs',
      mimeType: 'application/json',
      text: JSON.stringify(DOC_TEMPLATES, null, 2),
    }],
  })
);

// ============================================================
// Prompts: 预置提示词
// ============================================================

server.prompt(
  'plan_new_feature',
  '规划一个新功能的全栈开发',
  { featureName: z.string(), module: z.string() },
  ({ featureName, module }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `请为"${featureName}"功能规划全栈开发方案，所属模块: ${module}。

按以下流程执行:
1. 调用 get_cascade_changes 获取级联变更清单
2. 调用 get_parallel_strategy 获取并行策略
3. 调用 get_dev_standards aspect=all 获取开发规范
4. 按照级联链顺序实施: 数据库DDL → Store → 路由 → 导航 → 页面 → 构建测试 → 文档
5. 完成后调用 audit_completeness 进行审计`,
      },
    }],
  })
);

server.prompt(
  'batch_develop',
  '批量开发多个功能',
  { features: z.string().describe('功能列表(逗号分隔)'), module: z.string() },
  ({ features, module }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `请批量开发以下功能: ${features}，所属模块: ${module}。

执行策略:
1. 调用 generate_dev_plan 生成开发计划
2. 调用 get_parallel_strategy 确定Agent分配
3. 串行: 数据库DDL一次性完成所有表
4. 并行: Store+路由+导航 (1个Agent) + 页面开发 (分N个Agent)
5. 串行: 构建测试
6. 并行(后台): 3份文档更新
7. 最终: 完整性审计`,
      },
    }],
  })
);

// ============================================================
// Start Server
// ============================================================

const transport = new StdioServerTransport();
await server.connect(transport);
