// ──────────────────────────────────────────────────────────────────────────
// 第 6 课：RAG（检索增强生成）—— 让模型「带着资料」回答
//
// 一句话：RAG = 先去知识库里【检索】出相关片段，拼进 prompt，再让模型【生成】。
// 模型本身不变（还是那个纯函数），变的是「你喂给它的上下文」。
//
// 完整工具链（5 步，每步都是一个可替换的环节）：
//   ① 切块  chunk   ：把长文档切成小片段（检索的最小单位）
//   ② 向量化 embed  ：把每个片段变成向量（语义指纹）
//   ③ 入库  index   ：建一个向量库（这里就用内存数组）
//   ④ 检索  retrieve：把"问题"也向量化，算相似度取 top-k
//   ⑤ 增强生成 augment+generate：把 top-k 片段塞进 prompt，让模型据此作答 + 标引用
//
// 本课用「字符 n-gram 词袋」做一个【本地、零依赖、零额外费用】的玩具 embedding，
// 好处是无需 embedding 部署也能完整跑通整条链路、看清每一步。
// 生产里第②④步会换成真正的 embedding 模型 + 向量数据库（见 README）。
//
// 跑法：npm run rag
// ──────────────────────────────────────────────────────────────────────────

import { chat, modelLabel, usingRealModel } from "../lib/llm.js";
import type { ChatMessage } from "../lib/types.js";
import { DOCS } from "./corpus.js";

// ── ① 切块：把每篇文档按段落切成 Chunk ───────────────────────────────────────
interface Chunk {
  id: string; // 片段 id，如 "sla#1"
  docId: string;
  title: string;
  text: string;
}
function chunkDocs(): Chunk[] {
  const chunks: Chunk[] = [];
  for (const doc of DOCS) {
    const paras = doc.text.split("\n").map((s) => s.trim()).filter(Boolean);
    paras.forEach((p, i) => {
      chunks.push({ id: `${doc.id}#${i + 1}`, docId: doc.id, title: doc.title, text: p });
    });
  }
  return chunks;
}

// ── ② 向量化（玩具版）：中文按 字 + 相邻二字 切词，做 TF 词袋向量 ────────────────
// 真·embedding 是稠密语义向量；这里用稀疏词袋演示「文本 → 向量 → 算相似度」的形状。
function tokenize(text: string): string[] {
  const clean = text.toLowerCase().replace(/[\s，。、；：（）()【】%]/g, "");
  const grams: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    grams.push(clean[i]); // unigram（单字）
    if (i + 1 < clean.length) grams.push(clean[i] + clean[i + 1]); // bigram（相邻二字）
  }
  return grams;
}
function embed(text: string): Map<string, number> {
  const vec = new Map<string, number>();
  for (const t of tokenize(text)) vec.set(t, (vec.get(t) ?? 0) + 1);
  return vec;
}

// ── 余弦相似度：两个向量「方向」有多接近（0~1，越大越相关）───────────────────────
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, va] of a) dot += va * (b.get(k) ?? 0);
  const mag = (m: Map<string, number>) =>
    Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const denom = mag(a) * mag(b);
  return denom === 0 ? 0 : dot / denom;
}

// ── ③ 入库：预先把所有 chunk 向量化，存成内存「向量库」─────────────────────────
interface IndexedChunk extends Chunk {
  vec: Map<string, number>;
}
function buildIndex(chunks: Chunk[]): IndexedChunk[] {
  return chunks.map((c) => ({ ...c, vec: embed(`${c.title} ${c.text}`) }));
}

// ── ④ 检索：把 query 向量化，和库里每个 chunk 算相似度，取 top-k ─────────────────
interface Hit {
  chunk: IndexedChunk;
  score: number;
}
function retrieve(query: string, index: IndexedChunk[], k = 3): Hit[] {
  const qvec = embed(query);
  return index
    .map((chunk) => ({ chunk, score: cosine(qvec, chunk.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ── ⑤ 增强：把 top-k 片段拼成「带编号的上下文」，要求模型只依据它作答 + 标引用 ──────
function buildMessages(query: string, hits: Hit[]): ChatMessage[] {
  const context = hits
    .map((h, i) => `[${i + 1}] (${h.chunk.title}) ${h.chunk.text}`)
    .join("\n");
  const prompt = `你是企业知识库助手。只能依据下面提供的「资料」回答用户问题。
- 若资料里有答案，请作答，并在每个事实后用 [编号] 标注来源，如 [1]。
- 若资料里没有相关信息，明确回答「资料中未提及」，不要编造。

资料：
${context}

用户问题：${query}`;
  return [{ role: "user", content: prompt }];
}

// mock 模型不会真读上下文；为了让没配 .env 也有像样输出，这里做一个「抽取式」兜底：
// 直接回最相关片段并标引用。注意：这【不是模型生成】，只是把检索结果摆出来。
function extractiveAnswer(hits: Hit[]): string {
  if (!hits.length || hits[0].score === 0) return "资料中未提及。";
  return hits
    .filter((h) => h.score > 0)
    .slice(0, 2)
    .map((h, i) => `${h.chunk.text} [${i + 1}]`)
    .join("\n");
}

async function answerWithRag(query: string, index: IndexedChunk[]): Promise<void> {
  console.log(`\n🧑 用户: ${query}`);

  // 检索阶段（纯本地，无 LLM）—— 这是 RAG 工具链最该看清的一步
  const hits = retrieve(query, index, 3);
  console.log("  🔎 检索 top-3（相似度）:");
  for (const h of hits) {
    console.log(`     ${h.score.toFixed(3)}  [${h.chunk.id}] ${h.chunk.text.slice(0, 30)}…`);
  }

  // 生成阶段：真模型 → 据上下文作答；mock → 抽取式兜底
  const messages = buildMessages(query, hits);
  let reply: string;
  if (usingRealModel) {
    const msg = await chat(messages, []);
    reply = msg.content ?? "(空)";
  } else {
    reply = extractiveAnswer(hits) + "\n  （mock：非模型生成，仅摆出检索结果；配 .env 看真模型据此作答）";
  }
  console.log(`  🤖 RAG 答案:\n     ${reply.replace(/\n/g, "\n     ")}`);
}

// ── 对照组：不做检索，直接裸问模型（模型没见过 ZeroStore，只能说不知道或瞎编）──────
async function answerNaive(query: string): Promise<void> {
  if (!usingRealModel) {
    console.log(`  🤖 裸问（mock）: 我不掌握 ZeroStore 的内部资料。（真模型同样会「不知道/编造」）`);
    return;
  }
  const msg = await chat([{ role: "user", content: query }], []);
  console.log(`  🤖 裸问（无检索）: ${(msg.content ?? "").replace(/\n/g, " ")}`);
}

async function main() {
  console.log("=== 第 6 课：RAG（检索增强生成）===");
  console.log(`模型: ${modelLabel}`);

  // 建库（启动时一次性完成 ①②③）
  const chunks = chunkDocs();
  const index = buildIndex(chunks);
  console.log(`\n📚 知识库已就绪：${DOCS.length} 篇文档 → ${chunks.length} 个片段，已向量化入库。`);

  const queries = [
    "ZeroStore 单个对象最大能存多大？需要做什么？",
    "服务可用性如果只有 99.3%，能赔多少？多久内要申请？",
    "误删的文件还能恢复吗，保留几天？",
  ];

  // 案例一：先看「裸问 vs RAG」的对比，凸显检索的价值
  console.log("\n──────── 对比演示：裸问 vs RAG ────────");
  await answerNaive(queries[0]);
  await answerWithRag(queries[0], index);

  // 案例二、三：直接用 RAG 回答更多只在知识库里有答案的问题
  console.log("\n──────── 更多 RAG 问答 ────────");
  await answerWithRag(queries[1], index);
  await answerWithRag(queries[2], index);

  console.log(
    "\n👉 复盘：模型没变（还是纯函数）；变的是「检索 → 拼进 prompt」这层。" +
      "\n   检索全程无 LLM；模型只负责把检索到的片段组织成答案并标引用 —— 这就是 RAG 工具链。"
  );
}

await main();
