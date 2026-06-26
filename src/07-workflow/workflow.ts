// ──────────────────────────────────────────────────────────────────────────
// 第 7 课：Workflow（工作流编排）—— 面试高频区分：Workflow vs Agent
//
// ★ 一句话区分（务必背下来，几乎必问）：
//   · Workflow：控制流由【你的代码】写死，LLM 只在固定节点里做「生成/判断」。
//                路径可预测、可测试、便宜、稳定。
//   · Agent   ：控制流由【LLM 自己】决定（下一步调哪个工具、要不要继续）。
//                灵活、能应对开放任务，但不可控、贵、难测。
//   经验法则：能用 workflow 解决的，就别上 agent。先把流程写死，真需要动态决策再放权。
//
// 本课用 3 个最常见的 workflow 模式（来自 Anthropic《Building Effective Agents》）：
//   案例 1  Prompt Chaining + Gate ：分步串行，步骤之间插「代码质量门」
//   案例 2  Routing                ：先分类，再分发到不同分支
//   案例 3  Evaluator-Optimizer     ：生成器 + 评审器闭环，不达标就改
// （第 4 种 Parallelization 已在第 5 课 demo/dag 演示；Orchestrator-Workers 见 README）
//
// 跑法：npm run workflow
// ──────────────────────────────────────────────────────────────────────────

import { chat, modelLabel, usingRealModel } from "../lib/llm.js";
import type { ChatMessage } from "../lib/types.js";

// 统一的「LLM 节点」：真模型就调 chat()，mock 就用传入的兜底文本，保证整条流都能跑。
async function llmStep(prompt: string, mock: string): Promise<string> {
  if (!usingRealModel) return mock;
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const msg = await chat(messages, []);
  return (msg.content ?? "").trim();
}

// ── 案例 1：Prompt Chaining + Gate（分步串行 + 代码质量门）─────────────────────
// 流程：需求 →①LLM 生成大纲→【代码门：大纲必须≥3条，否则中止】→②LLM 按大纲扩写。
// 重点：「门」是你写的确定性 if，卡在两个 LLM 步骤【中间】，不达标就不浪费下一次调用。
async function caseChaining() {
  console.log("\n──────── 案例 1：Prompt Chaining + Gate ────────");
  const requirement = "给『织云对象存储 ZeroStore』写一篇面向开发者的简介";

  console.log("① LLM 生成大纲…");
  const outline = await llmStep(
    `为「${requirement}」列一个 3~5 条的提纲，每条一行，以「- 」开头，只输出提纲。`,
    "- 什么是 ZeroStore\n- 核心特性：高持久、强安全\n- 计费与免费额度\n- 如何接入"
  );
  const points = outline.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("-"));
  console.log(`   大纲（${points.length} 条）:\n   ${points.join("\n   ")}`);

  // 质量门：确定性检查，决定是否进入下一步
  if (points.length < 3) {
    console.log("   🚧 质量门未通过（提纲 < 3 条），流程中止，不再调用扩写。");
    return;
  }
  console.log("   ✅ 质量门通过，进入扩写。");

  console.log("② LLM 按大纲扩写…");
  const article = await llmStep(
    `严格按下面提纲，写一段不超过 120 字的简介：\n${points.join("\n")}`,
    "ZeroStore 是一款高持久、强安全的对象存储服务……（mock 占位）"
  );
  console.log(`   成稿: ${article.replace(/\n/g, " ")}`);
}

// ── 案例 2：Routing（先分类，再分发）─────────────────────────────────────────
// 流程：用户消息 →①LLM 分类成 退款/技术/其他 →② 路由到对应分支（各自不同处理/话术）。
// 重点：分类与处理【解耦】。每个分支可用不同 prompt、不同工具、甚至不同模型。
type Intent = "退款" | "技术" | "其他";
async function classify(message: string): Promise<Intent> {
  const out = await llmStep(
    `把下面的客服消息只归类成一个词：退款 / 技术 / 其他。只输出这一个词。\n消息：${message}`,
    // mock 兜底：用关键词本地分类，保证不配模型也能演示路由
    /退款|退钱|退款|发票|账单|多扣/.test(message) ? "退款" : /报错|失败|连不上|超时|bug/.test(message) ? "技术" : "其他"
  );
  if (out.includes("退款")) return "退款";
  if (out.includes("技术")) return "技术";
  return "其他";
}
async function handle(intent: Intent, message: string): Promise<string> {
  switch (intent) {
    case "退款":
      return "已为您转接【账单退款】专员，并附上退款政策：故障代金券需 60 天内申请。";
    case "技术":
      return await llmStep(
        `你是技术支持，用一句话给出排查建议。问题：${message}`,
        "请先检查网络与 AK/SK 配置，并查看是否触发 429 限流。（mock）"
      );
    default:
      return "已记录您的反馈，将由人工跟进。";
  }
}
async function caseRouting() {
  console.log("\n──────── 案例 2：Routing（路由分流）────────");
  const messages = [
    "你们这个月多扣了我 80 块钱，怎么退？",
    "SDK 上传一直报 429，是不是限流了？",
    "你们 logo 挺好看的",
  ];
  for (const m of messages) {
    const intent = await classify(m);
    const reply = await handle(intent, m);
    console.log(`   🧑 ${m}\n   ↳ 路由=[${intent}]  🤖 ${reply}`);
  }
}

// ── 案例 3：Evaluator-Optimizer（生成器 + 评审器闭环）─────────────────────────
// 流程：①生成器产出 →②评审器打分(0~10)+给意见 →③不达标则带着意见重写 → 循环至达标/上限。
// 重点：两个 LLM 角色（写手 + 评委）形成闭环，用「评分阈值 + 最大轮数」做确定性终止条件。
async function caseEvaluatorOptimizer() {
  console.log("\n──────── 案例 3：Evaluator-Optimizer（评审-优化循环）────────");
  const brief = "为 ZeroStore 写一句 20 字以内、突出『便宜+安全』的广告语";
  const THRESHOLD = 8;
  const MAX_ROUNDS = 3;

  let draft = "";
  let feedback = "";
  let mockScores = [6, 9]; // mock 模式下模拟「第一稿不达标、改后达标」

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // ① 生成（带上一轮评审意见）
    draft = await llmStep(
      `${brief}。${feedback ? "请根据评审意见改进：" + feedback : ""} 只输出广告语本身。`,
      round === 1 ? "ZeroStore，存得起。" : "ZeroStore：又便宜又安全，数据随你存。"
    );

    // ② 评审：让模型当评委，输出 JSON {score, comment}
    const review = await llmStep(
      `你是广告评委。给这句广告语按「是否突出便宜与安全、是否朗朗上口」打 0~10 分。` +
        `只输出 JSON：{"score": 数字, "comment": "一句改进意见"}。\n广告语：${draft}`,
      JSON.stringify({ score: mockScores[round - 1] ?? 9, comment: "再点明『安全』。" })
    );
    let score = 0;
    try {
      const m = review.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(m ? m[0] : review);
      score = Number(obj.score) || 0;
      feedback = String(obj.comment ?? "");
    } catch {
      feedback = "";
    }

    console.log(`   第 ${round} 轮: 稿=「${draft}」 评分=${score} 意见=${feedback || "—"}`);

    // ③ 确定性终止条件
    if (score >= THRESHOLD) {
      console.log(`   ✅ 达标（≥${THRESHOLD}），采用此稿。`);
      return;
    }
    if (round === MAX_ROUNDS) {
      console.log(`   ⏹ 到达最大轮数 ${MAX_ROUNDS}，采用当前最好一稿。`);
    } else {
      console.log("   🔁 未达标，带着意见重写…");
    }
  }
}

async function main() {
  console.log("=== 第 7 课：Workflow（工作流编排）===");
  console.log(`模型: ${modelLabel}`);
  console.log(
    "提示：Workflow 的控制流由代码写死，LLM 只在节点里生成/判断；与 Agent（LLM 自己决定下一步）相对。"
  );

  await caseChaining();
  await caseRouting();
  await caseEvaluatorOptimizer();

  console.log(
    "\n👉 复盘：三段控制流（串行+门 / 分类+分发 / 生成+评审闭环）全是【你写的代码】，" +
      "\n   LLM 只在节点里干活。这就是 workflow —— 可预测、可测试、可控成本。"
  );
}

await main();
