// ──────────────────────────────────────────────────────────────────────────
// 第 2 课 · 客户端：MCP Client + LLM 桥接 —— 把「三层翻译」演出来
//
// 这是整个 repo 的高潮。运行后看 stderr 日志，你会【亲眼】看到三层：
//
//   ① MCP server   —— 唯一懂 MCP/JSON-RPC 的人（在 server.ts，无 LLM）
//   ② runtime/client（本文件）—— 翻译官：tools/list 拿到工具 → 翻成模型格式 →
//                                  模型吐 tool_call → 它再 tools/call 去执行
//   ③ LLM          —— 只看到 tools 字段，【完全不知道 MCP 存在】
//
// 跑法：npm run mcp     （配了 .env 用真模型，否则 mock）
// ──────────────────────────────────────────────────────────────────────────

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chat, modelLabel } from "../lib/llm.js";
import type { ChatMessage, ToolDef } from "../lib/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const log = (...a: unknown[]) => console.error(...a);

// ── ① 连接 MCP server（用 tsx 把 server.ts 当子进程拉起来，走 stdio）──────────
const transport = new StdioClientTransport({
  command: process.execPath, // 当前 node
  args: ["--import", "tsx", join(here, "server.ts")], // 用 tsx 直接跑 TS
});
const mcp = new Client({ name: "toolchain-lab-client", version: "1.0.0" });
await mcp.connect(transport); // 背后自动完成 MCP 的 initialize 握手
log("\n[runtime] ② 已通过 MCP 连上 server（initialize 握手完成）");

// ── ② tools/list：向 server 要工具清单（这一步只有 runtime 和 server 懂 MCP）──
const { tools: mcpTools } = await mcp.listTools();
log(
  `[runtime] ② tools/list 拿到 ${mcpTools.length} 个工具:`,
  mcpTools.map((t) => t.name).join(", ")
);

// ── ②→③ 翻译：把 MCP 工具 schema 翻成「模型的 function calling 格式」──────────
//    模型只认这个格式。MCP 这个词从这里开始就【消失】了。
const llmTools: ToolDef[] = mcpTools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description ?? "",
    parameters: t.inputSchema as Record<string, unknown>, // MCP 的 inputSchema 本身就是 JSON Schema
  },
}));
log("[runtime] ② 已把工具翻译成模型格式，注意：发给模型的内容里没有 'MCP' 字样\n");

// ── ③ Agent 循环：模型决策 → runtime 通过 MCP 执行 → 回填 ────────────────────
async function runAgent(userQuestion: string): Promise<void> {
  const messages: ChatMessage[] = [{ role: "user", content: userQuestion }];
  log(`🧑 用户: ${userQuestion}`);

  for (let step = 0; step < 5; step++) {
    // ③ 模型这一层：它只看到 messages + llmTools，不知道 MCP
    const msg = await chat(messages, llmTools);
    messages.push(msg);

    if (!msg.tool_calls) {
      log(`🤖 最终答案: ${msg.content}\n`);
      return;
    }

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      log(`  ③ 模型吐出 tool_call: ${call.function.name}(${call.function.arguments})`);
      log(`  ② runtime 拦截 → 通过 MCP 的 tools/call 转发给 server…`);

      // ★ 真正去执行的是 runtime，通过 MCP，不是模型自己
      const res = await mcp.callTool({ name: call.function.name, arguments: args });
      const content = res.content as Array<{ type: string; text?: string }>;
      const text = content?.[0]?.text ?? "{}";
      log(`  ② runtime 收到 server 返回: ${text}`);

      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }
  log("⚠️ 达到最大步数，停止（防失控）");
}

log("=== 第 2 课：MCP 三层翻译 Demo ===");
log(`③ 模型: ${modelLabel}`);

await runAgent("北京今天天气咋样?");
await runAgent("帮我找无线耳机");

await mcp.close();
log("[runtime] 已关闭 MCP 连接。");
log(
  "\n👉 复盘：① server 全程没碰 LLM，只收结构化参数；" +
    "③ 模型全程没见过 'MCP'，只见 tools 字段；② runtime 是中间的翻译官+执行者。"
);
