// ──────────────────────────────────────────────────────────────────────────
// 第 4 课：可观测性（Observability）—— agent 是个黑盒，怎么知道它干了啥？
//
// 你前端做过埋点/链路追踪（trace_id 串起一次请求的所有 span），这里几乎是 1:1 迁移：
//   - 一次用户请求 = 一个 trace（带唯一 trace_id）。
//   - 每个步骤（调模型、调工具）= 一个 span（有名字、耗时、父子关系）。
//   - 跑完打印一棵「调用树」，一眼看出时间花哪了、谁调了谁。
//
// 面试价值：被问「线上 agent 出问题你怎么排查」时，你能答出 trace_id + span 这套，
// 而不是「我加几个 console.log」。
//
// 跑法：npm run observability
// ──────────────────────────────────────────────────────────────────────────

import { chat, modelLabel } from "../lib/llm.js";
import type { ChatMessage, ToolDef } from "../lib/types.js";

// ── 一个极简 Tracer：够把「trace_id + span + 耗时 + 父子」讲清楚 ──────────────
interface Span {
  id: number;
  parentId: number | null;
  name: string;
  startMs: number;
  endMs?: number;
  attrs: Record<string, unknown>;
}

class Tracer {
  readonly traceId = "tr_" + Math.random().toString(36).slice(2, 10);
  private spans: Span[] = [];
  private seq = 0;

  startSpan(name: string, parentId: number | null = null, attrs: Record<string, unknown> = {}): Span {
    const span: Span = { id: ++this.seq, parentId, name, startMs: performance.now(), attrs };
    this.spans.push(span);
    return span;
  }

  end(span: Span, attrs: Record<string, unknown> = {}): void {
    span.endMs = performance.now();
    Object.assign(span.attrs, attrs);
  }

  // 打印一棵调用树，带每个 span 的耗时与属性
  print(): void {
    const dur = (s: Span) => (s.endMs ? (s.endMs - s.startMs).toFixed(0) : "?");
    const walk = (parentId: number | null, depth: number) => {
      for (const s of this.spans.filter((x) => x.parentId === parentId)) {
        const indent = "  ".repeat(depth);
        const attrs = Object.keys(s.attrs).length ? "  " + JSON.stringify(s.attrs) : "";
        console.log(`${indent}└─ ${s.name}  ⏱ ${dur(s)}ms${attrs}`);
        walk(s.id, depth + 1);
      }
    };
    console.log(`\n📊 Trace ${this.traceId}（调用树）`);
    walk(null, 0);
  }
}

// ── 工具 ────────────────────────────────────────────────────────────────────
function getWeather({ city }: { city: string }) {
  const db: Record<string, { temp: number; sky: string }> = {
    北京: { temp: 18, sky: "晴" },
    上海: { temp: 24, sky: "多云" },
  };
  return { city, ...(db[city] ?? { temp: 20, sky: "未知" }) };
}
const toolImpls: Record<string, (args: any) => unknown> = { getWeather };

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "getWeather",
      description: "查询某城市的实时天气。",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "城市名" } },
        required: ["city"],
      },
    },
  },
];

// ── 被全程「埋点」的 agent 循环 ──────────────────────────────────────────────
async function runAgent(tracer: Tracer, userQuestion: string): Promise<void> {
  const root = tracer.startSpan("agent.run", null, { question: userQuestion });
  const messages: ChatMessage[] = [{ role: "user", content: userQuestion }];

  for (let step = 0; step < 5; step++) {
    const modelSpan = tracer.startSpan(`llm.call#${step + 1}`, root.id);
    const msg = await chat(messages, tools);
    tracer.end(modelSpan, { decided: msg.tool_calls ? "tool_call" : "final" });
    messages.push(msg);

    if (!msg.tool_calls) {
      tracer.end(root, { result: "done" });
      console.log(`🤖 ${msg.content}`);
      return;
    }

    for (const call of msg.tool_calls) {
      const toolSpan = tracer.startSpan(`tool.${call.function.name}`, root.id, {
        args: call.function.arguments,
      });
      const args = JSON.parse(call.function.arguments);
      const result = toolImpls[call.function.name]?.(args) ?? { error: "no such tool" };
      tracer.end(toolSpan, { ok: !("error" in (result as object)) });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  tracer.end(root, { result: "max-steps" });
}

console.log("=== 第 4 课：可观测性（trace_id + span）===");
console.log(`模型: ${modelLabel}`);

const tracer = new Tracer();
console.log(`\n🧑 用户: 北京今天天气咋样? （trace_id=${tracer.traceId}）`);
await runAgent(tracer, "北京今天天气咋样?");
tracer.print();

console.log("\n👉 复盘：trace_id 串起一次请求的所有 span；调用树一眼看出耗时分布与调用关系。");
console.log("   线上排查就靠它：按 trace_id 捞日志，比满屏 console.log 强一个量级。");
