// ──────────────────────────────────────────────────────────────────────────
// 第 1 课：Function Calling —— 让模型「调用你的函数」
//
// 盯住三件事（面试就考这个）：
//   1. 模型从不自己执行函数，它只「返回意图」(tool_calls)，执行权在你。
//   2. 工具结果要「回填」给模型 (role:"tool")，它才能接着推理。← ReAct 的 Observation
//   3. for 循环 + 最大步数 = Agent 的本质 + 防失控。
//
// 跑法：
//   node 01-function-calling/demo.mjs      （配了 .env 用真模型，否则 mock）
// ──────────────────────────────────────────────────────────────────────────

import { chat, modelLabel } from "../lib/azure.mjs";

// 1️⃣ 你写的普通函数。模型不能自己执行它——它只能「请求」你执行。
//    （真实场景这里就是 await fetch(天气API) / 查数据库 / 调内部服务）
function getWeather({ city }) {
  const db = {
    北京: { temp: 18, sky: "晴" },
    上海: { temp: 24, sky: "多云" },
    深圳: { temp: 30, sky: "雷阵雨" },
  };
  return { city, ...(db[city] ?? { temp: 20, sky: "未知" }) };
}

function searchProduct({ keyword }) {
  return { keyword, results: [`${keyword} Pro`, `${keyword} Mini`], count: 2 };
}

// 把本地函数登记成「工具表」，name 必须和函数对得上。
const toolImpls = { getWeather, searchProduct };

// 2️⃣ 把函数「登记」给模型——本质就是给函数写 TS 类型 + JSDoc。
//    description 是给模型看的文档；parameters 是参数的类型定义 (JSON Schema)。
const tools = [
  {
    type: "function",
    function: {
      name: "getWeather",
      description: "查询某城市的实时天气。用户问天气时调用。",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "城市名，如 北京" } },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchProduct",
      description: "按关键词搜索商品。用户想找/买东西时调用。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "搜索关键词" } },
        required: ["keyword"],
      },
    },
  },
];

// 3️⃣ Agent 循环（就是个带「决策大脑」的 Redux 循环）。
async function runAgent(userQuestion) {
  const messages = [{ role: "user", content: userQuestion }];
  console.log(`\n🧑 用户: ${userQuestion}`);

  for (let step = 0; step < 5; step++) {
    // 最大步数=防死循环，跟防无限 render 一样
    const msg = await chat({ messages, tools });
    messages.push(msg);

    // 模型说「不用调工具了」，给出最终答案 → 退出循环
    if (!msg.tool_calls) {
      console.log(`🤖 最终答案: ${msg.content}`);
      return msg.content;
    }

    // 4️⃣ 模型只是「请求」调用，真正执行的是你（像 React 把 DOM 操作交给 reconciler）
    for (const call of msg.tool_calls) {
      const fn = toolImpls[call.function.name];
      const callArgs = JSON.parse(call.function.arguments); // 模型生成的参数（字符串！要 parse）
      console.log(`  🔧 模型决定调用 ${call.function.name}(${call.function.arguments})`);

      const result = fn ? fn(callArgs) : { error: "no such tool" };

      messages.push({
        // 把结果「回填」（像 dispatch 一个 action）
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      console.log(`  📥 工具返回: ${JSON.stringify(result)}`);
    }
  }
  console.log("⚠️ 达到最大步数，停止（防失控）");
}

// ── 跑几个例子 ──────────────────────────────────────────────────────────────
console.log("=== 第 1 课：Function Calling Demo ===");
console.log(`模型: ${modelLabel}\n`);

await runAgent("北京今天天气咋样?");
await runAgent("帮我找无线耳机");
await runAgent("你好呀");
