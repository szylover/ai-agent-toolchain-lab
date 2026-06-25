// ──────────────────────────────────────────────────────────────────────────
// 第 5 课：多工具编排（Orchestration）—— 工具一多，怎么选、怎么并行？
//
// 面试常问：
//   - 「有 10 个工具，模型怎么知道调哪个？」→ 靠每个工具的 description（写好它=路由准）。
//   - 「能不能一次调多个？」→ 能。模型一个回合可以吐出【多个 tool_call】。
//   - 「多个工具调用要串行吗？」→ 互相不依赖就【并行】（Promise.all），省时间。
//
// 本课用 4 个工具 + 一个会触发多调用的问题，演示「模型选路 + runtime 并行执行」。
//
// 跑法：npm run orchestration
// ──────────────────────────────────────────────────────────────────────────

import { chat, modelLabel } from "../lib/llm.js";
import type { ChatMessage } from "../lib/types.js";
import { tools, toolImpls } from "./tools.js";

// ── agent 循环：关键在「一回合多个 tool_call → 并行执行」──────────────────────
async function runAgent(userQuestion: string): Promise<void> {
  const messages: ChatMessage[] = [{ role: "user", content: userQuestion }];
  console.log(`\n🧑 用户: ${userQuestion}`);

  for (let step = 0; step < 5; step++) {
    const msg = await chat(messages, tools);
    messages.push(msg);

    if (!msg.tool_calls) {
      console.log(`🤖 最终答案: ${msg.content}`);
      return;
    }

    const n = msg.tool_calls.length;
    console.log(
      `  🧭 模型这一回合决定调 ${n} 个工具: ${msg.tool_calls
        .map((c) => c.function.name)
        .join(", ")}` + (n > 1 ? "  → 互不依赖，并行执行！" : "")
    );

    // ★ 并行执行：互不依赖的工具用 Promise.all 一起跑，而不是 for-await 串行
    const t0 = performance.now();
    const toolMessages = await Promise.all(
      msg.tool_calls.map(async (call) => {
        const args = JSON.parse(call.function.arguments);
        const started = (performance.now() - t0).toFixed(0);
        const result = await toolImpls[call.function.name]?.(args);
        const ended = (performance.now() - t0).toFixed(0);
        console.log(
          `    🔧 ${call.function.name}(${call.function.arguments})  [+${started}ms → +${ended}ms]`
        );
        return {
          role: "tool" as const,
          tool_call_id: call.id,
          content: JSON.stringify(result ?? { error: "no such tool" }),
        };
      })
    );
    const wall = (performance.now() - t0).toFixed(0);
    console.log(
      `  ⏱ ${n} 个工具总墙钟 ${wall}ms（串行约需 ${n * 500}ms，并行省下约 ${Math.max(
        0,
        n * 500 - Number(wall)
      )}ms）`
    );

    messages.push(...toolMessages);
  }
  console.log("⚠️ 达到最大步数，停止（防失控）");
}

console.log("=== 第 5 课：多工具编排（选路 + 并行）===");
console.log(`模型: ${modelLabel}`);

// 这个问题会逼模型同时调好几个工具（天气 x2 + 货币），正好演示并行
await runAgent("北京和上海现在分别多少度？另外帮我把 100 美元换成人民币。");
// 这个只需要一个工具，演示「从 4 个里精准选 1 个」
await runAgent("帮我找个机械键盘");

console.log("\n👉 复盘：选哪个工具靠 description（写好=路由准）；一回合可吐多个 tool_call；");
console.log("   互不依赖就 Promise.all 并行——这就是 agent 的「编排」雏形。");
