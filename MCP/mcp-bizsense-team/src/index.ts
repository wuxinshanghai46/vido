#!/usr/bin/env node
/**
 * 业务感知系统 - 研发团队 MCP Server
 * 暴露团队花名册与按角色咨询（Tools），供 Cursor 等 MCP 客户端使用。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getRole, rosterAsText, rosterAsJson } from "./team.js";

// MCP 服务名：bizsense（业务感知系统）
const server = new McpServer({ name: "bizsense", version: "1.0.0" });

server.tool(
  "get_team_roster",
  {
    format: z
      .enum(["text", "json"])
      .optional()
      .default("text")
      .describe("返回格式：text=Markdown 列表，json=结构化 JSON"),
  },
  async ({ format }) => ({
    content: [
      { type: "text" as const, text: format === "json" ? rosterAsJson() : rosterAsText() },
    ],
  })
);

server.tool(
  "consult_team_role",
  {
    role: z
      .enum(["F", "L", "Z", "D", "S", "B", "Q"])
      .describe("角色：F=产品,L=前端,Z=后端,D=架构,S=UI,B=运维,Q=测试"),
    topic: z.string().optional().describe("咨询主题或问题，可选"),
  },
  async ({ role, topic }) => {
    const r = getRole(role);
    if (!r) {
      return {
        content: [{ type: "text" as const, text: `未找到角色：${role}` }],
        isError: true,
      };
    }
    const lines = [
      `**${r.id}（${r.name}）**`,
      `- 职责：${r.focus}`,
      `- 产出：${r.output}`,
    ];
    if (topic?.trim()) {
      lines.push("", `咨询主题：${topic.trim()}`, "请结合该角色职责与项目文档（如 F_按最新方案开发_任务指派、Z_界面重新设计）给出建议。");
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
