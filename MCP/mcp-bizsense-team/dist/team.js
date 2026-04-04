/**
 * 业务感知系统 - 研发团队定义（与 F_按最新方案开发_任务指派 一致）
 */
export const TEAM_ROSTER = [
    {
        id: "F",
        name: "产品经理",
        focus: "需求、PRD、任务指派、验收基准；依据需求文档与截图",
        output: "MD文件/F_*.md、需求分析与产品设计等",
    },
    {
        id: "L",
        name: "前端工程师",
        focus: "页面实现、ECharts、主布局、与 API 对接；依据 Z_界面重新设计",
        output: "ui-demo/*.html、L_前端开发_开发记录.md",
    },
    {
        id: "Z",
        name: "后端开发工程师",
        focus: "REST 接口、实体与表、验证码/监控/企业/通道/预警/日志/消息",
        output: "backend 下 Controller/Service/Entity、Z_后端开发_开发记录.md",
    },
    {
        id: "D",
        name: "架构师",
        focus: "架构评审、与界面文档 API 对应、接口清单与数据表说明",
        output: "D_架构与接口_开发记录.md",
    },
    {
        id: "S",
        name: "UI 设计师",
        focus: "视觉与组件核对、与 UI 规范差异清单及调整建议",
        output: "S_UI设计_开发记录.md、UI设计规范",
    },
    {
        id: "B",
        name: "运维工程师",
        focus: "部署、启动顺序、端口、环境变量、Nginx、脚本",
        output: "B_部署与运行_开发记录.md、启动脚本",
    },
    {
        id: "Q",
        name: "测试工程师",
        focus: "测试用例、执行记录、与产品/界面文档验收",
        output: "Q_测试_开发记录.md、PlatformApiTest 等",
    },
];
export function getRole(roleId) {
    return TEAM_ROSTER.find((r) => r.id === roleId.toUpperCase());
}
export function rosterAsText() {
    return TEAM_ROSTER.map((r) => `- **${r.id}（${r.name}）**：${r.focus}；输出 ${r.output}`).join("\n");
}
export function rosterAsJson() {
    return JSON.stringify(TEAM_ROSTER, null, 2);
}
