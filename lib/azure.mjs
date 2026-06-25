// ──────────────────────────────────────────────────────────────────────────
// 共享的「模型调用层」：把 Azure OpenAI 包成一个简单的 chat() 函数。
//
// 关键点（面试常考）：
//   - LLM 是一个「纯函数」：输入 messages + tools，输出一条 assistant 消息。
//   - 它要么给 content（最终答案），要么给 tool_calls（请求你调工具）。
//   - 它自己【不执行】任何工具，也【不知道】MCP——它只认 tools 字段。
//
// 没有 key 也能跑：不设环境变量时自动退化成 mock 模型（见 mockChat）。
// ──────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 无依赖加载 .env（Node 20.12+ 自带 process.loadEnvFile）
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* 老版本 Node 没有 loadEnvFile，忽略即可（可改用 --env-file 启动） */
  }
}

const hasRealKey = !!process.env.AZURE_OPENAI_API_KEY;

/**
 * chat({ messages, tools }) => assistant 消息
 * 接口对 mock / 真模型完全一致 —— 这就是「面向接口编程」。
 */
export async function chat({ messages, tools }) {
  if (hasRealKey) return realChat({ messages, tools });
  return mockChat({ messages, tools });
}

export const usingRealModel = hasRealKey;
export const modelLabel = hasRealKey
  ? `真模型 (Azure: ${process.env.AZURE_OPENAI_DEPLOYMENT})`
  : "mock 模型（未配置 .env，零成本运行）";

// ── 真模型：Azure OpenAI ────────────────────────────────────────────────────
async function realChat({ messages, tools }) {
  const { AzureOpenAI } = await import("openai");
  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-08-01-preview",
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  });
  const res = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages,
    tools,
    tool_choice: "auto",
  });
  return res.choices[0].message;
}

// ── mock 模型：用规则模拟「模型的决策」，让你不花钱也能看懂整条链路 ──────────
let mockTurn = 0;
function mockChat({ messages }) {
  const lastTool = [...messages].reverse().find((m) => m.role === "tool");
  const userText = messages.find((m) => m.role === "user")?.content ?? "";

  if (!lastTool || mockTurn === 0) {
    mockTurn++;
    if (userText.includes("天气") || /weather/i.test(userText)) {
      const city = ["北京", "上海", "深圳"].find((c) => userText.includes(c)) ?? "北京";
      return toolCall("getWeather", { city });
    }
    if (/买|找|搜|search/i.test(userText)) {
      const kw = userText.replace(/.*(买|找|搜索?)/, "").trim() || "耳机";
      return toolCall("searchProduct", { keyword: kw });
    }
    return { role: "assistant", content: "我可以帮你查天气或找商品，试试问“北京天气”？" };
  }

  mockTurn = 0;
  const data = JSON.parse(lastTool.content);
  if ("sky" in data)
    return { role: "assistant", content: `${data.city}今天${data.sky}，气温约 ${data.temp}℃。` };
  if ("results" in data)
    return {
      role: "assistant",
      content: `找到 ${data.count} 个“${data.keyword}”相关商品：${data.results.join("、")}。`,
    };
  return { role: "assistant", content: "我处理好了。" };
}

function toolCall(name, args) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_" + Math.random().toString(36).slice(2, 8),
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}
