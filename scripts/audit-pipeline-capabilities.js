const fs = require('fs');
const path = require('path');
const { auditPipelineCapabilities } = require('../src/services/pipelineCapabilityAuditService');

const root = path.join(__dirname, '..');
const jsonPath = path.join(root, 'outputs', 'audits', 'pipeline-capability-audit.json');
const markdownPath = path.join(root, 'docs', 'research', '2026-07-29-pipeline-capability-audit.md');

function markdown(report) {
  const lines = [
    '# VIDO 模型能力端到端审计',
    '',
    `> 生成时间：${report.generated_at}`,
    '',
    '本报告只读取现有模型调用管理、业务代码引用和能力元数据，不创建第二套模型注册表，也不执行真实付费调用。',
    '',
    '## 汇总',
    '',
    `- 业务组：${report.summary.group_count}`,
    `- 阶段：${report.summary.stage_count}`,
    `- 已在业务代码中静态引用：${report.summary.referenced_stage_count}`,
    `- 未发现业务代码静态引用：${report.summary.unreferenced_stage_count}`,
    `- 没有启用模型的阶段：${report.summary.stages_without_enabled_model}`,
    `- 显式能力标记：${report.summary.explicit_capability_assignment_count}`,
    `- 已验证能力标记：${report.summary.verified_capability_assignment_count}`,
    '',
    '“未发现静态引用”是需要继续人工追踪的证据，不直接等同于功能不可用；它表示模型调用管理中的阶段 ID 没有出现在业务执行代码中。',
    '',
    '## 高级能力链路',
    '',
    '| 能力 | 业务需要 | 业务输入 | 适配器参数 | 供应商参数 | 状态 |',
    '|---|---|---|---|---|---|',
    ...report.advanced_chain_findings.map(item =>
      `| ${item.capability} | ${item.business_need ? '是' : '否'} | ${item.business_input || '-'} | ${item.adapter_parameter || '-'} | ${item.provider_parameter || '-'} | ${item.status} |`),
    '',
    '## 阶段连接矩阵',
    '',
    '| 业务组 | 阶段 | 类型 | 启用模型 | 业务引用 | 状态 |',
    '|---|---|---:|---:|---:|---|',
    ...report.stages.map(stage =>
      `| ${stage.group} | \`${stage.stage_id}\` | ${stage.type} | ${stage.enabled_model_count} | ${stage.business_reference_count} | ${stage.connection_status} |`),
    '',
    '## 未发现业务静态引用的阶段',
    '',
    ...report.stages
      .filter(stage => stage.business_reference_count === 0)
      .map(stage => `- \`${stage.stage_id}\`：${stage.name}`),
    '',
    '## 解释边界',
    '',
    '- 模型名称推断只能作为候选能力，不能标记为真实已验证。',
    '- 真实 verified 状态必须来自最小付费调用、结果归档、费用和任务状态核对。',
    '- 当前剧情广告原生音频关闭是有意设计：平台先生成独立 TTS，再做确定性混音，避免双音轨和重复计费。',
    '- 参考视频当前用于反推镜头、动作和提示词，不等于把视频作为供应商动作参考素材直接提交。',
    '',
  ];
  return lines.join('\n');
}

function main() {
  const report = auditPipelineCapabilities();
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, markdown(report), 'utf8');
  console.log(JSON.stringify({
    json: path.relative(root, jsonPath),
    markdown: path.relative(root, markdownPath),
    summary: report.summary,
  }, null, 2));
}

main();
