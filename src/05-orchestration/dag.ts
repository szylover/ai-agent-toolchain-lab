// ──────────────────────────────────────────────────────────────────────────
// 第 5 课（进阶）：DAG 编排 —— 有依赖的工具怎么调度（plan-then-execute）
//
// 对比 demo.ts：那里是「模型驱动的多回合循环」，一回合并行、有依赖就靠下一回合。
// 这里是业界另一套通用方案（LLMCompiler / plan-and-execute 思路）：
//   1. 模型【先一次性】产出一张带依赖的「计划图(DAG)」——每个节点标 dependsOn。
//   2. 节点的参数可以【引用上游节点的输出】，用占位符 ${nodeId.field}。
//   3. runtime 拿到图后【拓扑调度】：依赖都就绪的节点并行跑，有依赖的等上游。
//      —— 这一步【没有 LLM】，纯 runtime 调度，省 token、确定性强、并行最大化。
//
// 这正是你说的「给 function call 的数据结构加一个 pre-node finished」：
//   就是下面 PlanNode 里的 dependsOn 字段。
//
// 跑法：npm run dag
// ──────────────────────────────────────────────────────────────────────────

import { chat, modelLabel } from "../lib/llm.js";
import type { ChatMessage } from "../lib/types.js";
import { toolImpls, tools } from "./tools.js";

// ── 你问的「数据结构」：function call 节点 + 依赖（pre-node）────────────────────
interface PlanNode {
  id: string; // 节点 id，如 "n1"
  tool: string; // 要调的工具名
  args: Record<string, unknown>; // 参数，值里可含占位符，如 "${n1.temp}"
  dependsOn: string[]; // 前置节点（pre-nodes）：它们 finished 后本节点才能跑
}

// ── 占位符解析：把 ${n1.temp} 替换成上游 n1 结果里的 temp 字段 ──────────────────
function getPath(obj: any, path: string): unknown {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function resolveArgs(
  args: Record<string, unknown>,
  results: Record<string, any>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      const m = v.match(/^\$\{(\w+)\.([\w.]+)\}$/); // 整串就是一个引用 → 保留原类型(数字)
      if (m) {
        out[k] = getPath(results[m[1]], m[2]);
        continue;
      }
      // 字符串内嵌引用 → 文本替换
      out[k] = v.replace(/\$\{(\w+)\.([\w.]+)\}/g, (_s, id, p) => String(getPath(results[id], p)));
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── 拓扑调度器：依赖就绪就并行跑，没 LLM 什么事 ───────────────────────────────
async function executeDag(plan: PlanNode[]): Promise<Record<string, any>> {
  const byId = new Map(plan.map((n) => [n.id, n]));
  const results: Record<string, any> = {};
  const done = new Set<string>();
  const t0 = performance.now();
  let wave = 0;

  while (done.size < plan.length) {
    // 找出「所有依赖都已完成、自己还没跑」的节点 —— 它们之间互不依赖，可并行
    const ready = plan.filter((n) => !done.has(n.id) && n.dependsOn.every((d) => done.has(d)));
    if (ready.length === 0) throw new Error("DAG 死锁：存在环或缺失依赖");

    wave++;
    console.log(
      `\n  🌊 第 ${wave} 波（并行 ${ready.length} 个）: ${ready.map((n) => n.id).join(", ")}`
    );

    await Promise.all(
      ready.map(async (node) => {
        const args = resolveArgs(node.args, results); // 把 ${上游.字段} 填成真值
        const refNote = JSON.stringify(node.args) !== JSON.stringify(args) ? `  ←解析自 ${JSON.stringify(node.args)}` : "";
        const start = (performance.now() - t0).toFixed(0);
        const res = await toolImpls[node.tool]?.(args);
        const end = (performance.now() - t0).toFixed(0);
        results[node.id] = res;
        done.add(node.id);
        console.log(
          `    🔧 ${node.id}: ${node.tool}(${JSON.stringify(args)})${refNote}  [+${start}ms → +${end}ms]`
        );
      })
    );
  }
  console.log(`\n  ⏱ 全图完成，墙钟 ${(performance.now() - t0).toFixed(0)}ms`);
  return results;
}

// ── 让模型「规划」出 DAG（一次 LLM 调用）。失败/mock 时用兜底计划，保证可跑 ──────
const FALLBACK_PLAN: PlanNode[] = [
  { id: "n1", tool: "getWeather", args: { city: "北京" }, dependsOn: [] },
  { id: "n2", tool: "getWeather", args: { city: "上海" }, dependsOn: [] },
  // n3 依赖 n1：金额来自北京气温，必须等 n1 完成
  { id: "n3", tool: "convertCurrency", args: { amount: "${n1.temp}", from: "USD", to: "CNY" }, dependsOn: ["n1"] },
];

async function planWithLLM(userQuestion: string): Promise<PlanNode[]> {
  const toolDesc = tools
    .map((t) => `- ${t.function.name}(${Object.keys((t.function.parameters as any).properties).join(", ")}): ${t.function.description}`)
    .join("\n");

  const sys = `你是一个任务规划器。把用户请求拆成一张工具调用 DAG，只输出 JSON，不要任何解释。
可用工具：
${toolDesc}

输出格式（数组）：
[{"id":"n1","tool":"工具名","args":{...},"dependsOn":[]}]

规则：
- 互不依赖的节点 dependsOn 留空数组，它们会被并行执行。
- 若某节点的参数需要用到另一个节点的输出，用占位符 "\${上游id.字段}"（如 "\${n1.temp}"），并在 dependsOn 里写上该上游 id。
- 只用上面列出的工具。`;

  const messages: ChatMessage[] = [
    { role: "user", content: sys + "\n\n用户请求：" + userQuestion },
  ];
  const msg = await chat(messages, []); // 不给 tools，要它直接产出 JSON 计划
  const text = msg.content ?? "";
  const jsonMatch = text.match(/\[[\s\S]*\]/); // 抠出 JSON 数组
  if (!jsonMatch) {
    console.log("  ⚠️ 模型未产出可解析的计划，使用兜底计划。");
    return FALLBACK_PLAN;
  }
  try {
    const plan = JSON.parse(jsonMatch[0]) as PlanNode[];
    // 基本校验：工具存在、dependsOn 引用存在
    const ids = new Set(plan.map((n) => n.id));
    const valid =
      plan.length > 0 &&
      plan.every((n) => toolImpls[n.tool] && (n.dependsOn ?? []).every((d) => ids.has(d)));
    if (!valid) throw new Error("计划校验失败");
    plan.forEach((n) => (n.dependsOn = n.dependsOn ?? []));
    return plan;
  } catch {
    console.log("  ⚠️ 计划 JSON 非法，使用兜底计划。");
    return FALLBACK_PLAN;
  }
}

// ── 主流程：规划 → 调度执行 → （可选）让模型总结 ─────────────────────────────
async function main() {
  console.log("=== 第 5 课（进阶）：DAG 编排（plan-then-execute）===");
  console.log(`模型: ${modelLabel}`);

  const question =
    "查一下北京现在多少度，并把这个温度数值当作美元金额换算成人民币；同时单独查一下上海的天气。";
  console.log(`\n🧑 用户: ${question}`);

  console.log("\n① 规划阶段（一次 LLM 调用，产出带依赖的 DAG）：");
  const plan = await planWithLLM(question);
  for (const n of plan) {
    const dep = n.dependsOn.length ? `  ⟸ 依赖 ${n.dependsOn.join(",")}` : "  （无依赖）";
    console.log(`   ${n.id}: ${n.tool}(${JSON.stringify(n.args)})${dep}`);
  }

  console.log("\n② 执行阶段（runtime 拓扑调度，无 LLM）：");
  const results = await executeDag(plan);

  console.log("\n③ 结果：");
  for (const [id, r] of Object.entries(results)) console.log(`   ${id} →`, JSON.stringify(r));

  console.log(
    "\n👉 复盘：无依赖节点同波并行；有依赖的（n3 用到 n1 的气温）自动等上游完成、并把 ${n1.temp} 解析成真值。"
  );
  console.log(
    "   对比 demo.ts 的多回合循环：DAG 只规划一次 LLM，调度阶段零 LLM——省 token、确定性强、并行更充分，但不灵活。"
  );
}

await main();
