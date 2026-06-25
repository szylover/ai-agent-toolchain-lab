// ──────────────────────────────────────────────────────────────────────────
// 第 2 课 · 服务端：一个【真正的 MCP Server】
//
// 重点（把你之前的疑问彻底坐实）：
//   ★ 这个文件里【没有任何 LLM】。它就是个「哑」的、确定性的执行器。
//     ——像一个 Express 后端：收到结构化参数 → 干活 → 返回结构化结果。
//   ★ 它通过 MCP 协议（JSON-RPC 2.0 over stdio）对外暴露工具。
//   ★ 它【不知道】上游有没有模型、是 GPT 还是 Claude，它只认 tools/call 请求。
//
// 你不用单独启动它——client.mjs 会把它当子进程拉起来（stdio transport）。
// ──────────────────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// stderr 才能安全打日志：stdout 被 JSON-RPC 协议独占，往里写普通文字会污染协议。
const log = (...a) => console.error("  [MCP server]", ...a);

const server = new McpServer({ name: "weather-shop-server", version: "1.0.0" });

// 工具 1：查天气。注意这里收到的是【结构化参数】，不是一句自然语言。
server.tool(
  "getWeather",
  "查询某城市的实时天气。",
  { city: z.string().describe("城市名，如 北京") },
  async ({ city }) => {
    log(`收到 tools/call getWeather(city=${city}) ← 结构化参数，不是自然语言！`);
    const db = {
      北京: { temp: 18, sky: "晴" },
      上海: { temp: 24, sky: "多云" },
      深圳: { temp: 30, sky: "雷阵雨" },
    };
    const data = { city, ...(db[city] ?? { temp: 20, sky: "未知" }) };
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

// 工具 2：搜商品。
server.tool(
  "searchProduct",
  "按关键词搜索商品。",
  { keyword: z.string().describe("搜索关键词") },
  async ({ keyword }) => {
    log(`收到 tools/call searchProduct(keyword=${keyword})`);
    const data = { keyword, results: [`${keyword} Pro`, `${keyword} Mini`], count: 2 };
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
log("已启动，等待 JSON-RPC 请求（initialize / tools/list / tools/call）…");
