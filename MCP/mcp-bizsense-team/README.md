# 业务感知系统 MCP Server（bizsense）

将当前业务感知系统封装为 MCP Server `bizsense`，其中包含：

- 研发团队（F/L/Z/D/S/B/Q）相关工具，用于查询花名册或按角色咨询；
- （可扩展）应用级工具，用于总览系统结构、启动命令等。

## 团队角色

| ID | 角色         | 职责概要 |
|----|--------------|----------|
| F  | 产品经理     | 需求、PRD、任务指派、验收 |
| L  | 前端工程师   | 页面、ECharts、与 API 对接 |
| Z  | 后端开发工程师 | REST 接口、实体与表、业务逻辑 |
| D  | 架构师       | 架构评审、API 与数据表说明 |
| S  | UI 设计师    | 视觉与组件、UI 规范 |
| B  | 运维工程师   | 部署、端口、环境、脚本 |
| Q  | 测试工程师   | 测试用例、执行记录、验收 |

## 安装与运行

```bash
cd mcp-bizsense-team
npm install
npm run build
node dist/index.js
```

或开发时：`npx tsx src/index.ts`（需先 `npm i -D tsx`）。

## 暴露的 MCP 工具

1. **get_team_roster**  
   - 参数：`format`（可选，`"text"` | `"json"`，默认 `text`）  
   - 返回：团队花名册，Markdown 列表或 JSON。

2. **consult_team_role**  
   - 参数：`role`（必填，F/L/Z/D/S/B/Q）、`topic`（可选，咨询主题）  
   - 返回：该角色职责与产出说明；若带 `topic`，可引导结合项目文档给出建议。

## 在 Cursor 中启用

1. 打开 Cursor 设置 → **MCP**（或编辑 `~/.cursor/mcp.json` / 项目 `.cursor/mcp.json`）。
2. 添加一条 server 配置，例如：

```json
{
  "mcpServers": {
    "bizsense": {
      "command": "node",
      "args": ["e:/AI/业务感知/mcp-bizsense-team/dist/index.js"]
    }
  }
}
```

请将 `e:/AI/业务感知` 换成你本地的项目根路径；若使用 `npx` 或全局安装，可改为：

```json
{
  "mcpServers": {
    "bizsense": {
      "command": "node",
      "args": ["<项目根>/mcp-bizsense-team/dist/index.js"]
    }
  }
}
```

3. 重启 Cursor 或重新加载 MCP，即可在对话中让 AI 调用 `get_team_roster`、`consult_team_role`。

## 数据来源

角色定义与 `MD文件/F_按最新方案开发_任务指派.md` 中「人员分工与开发记录」一致；如需调整，请改 `src/team.ts` 后重新 `npm run build`。
