// 第 5 课共用的工具集合：4 个带 500ms 延迟的「假外部服务」，
// 供 demo.ts（一回合并行）和 dag.ts（依赖图调度）复用。

import type { ToolDef } from "../lib/types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getWeather({ city }: { city: string }) {
  await sleep(500);
  const db: Record<string, { temp: number; sky: string }> = {
    北京: { temp: 18, sky: "晴" },
    上海: { temp: 24, sky: "多云" },
    深圳: { temp: 30, sky: "雷阵雨" },
  };
  return { city, ...(db[city] ?? { temp: 20, sky: "未知" }) };
}

export async function searchProduct({ keyword }: { keyword: string }) {
  await sleep(500);
  return { keyword, results: [`${keyword} Pro`, `${keyword} Mini`], count: 2 };
}

export async function convertCurrency({ amount, from, to }: { amount: number; from: string; to: string }) {
  await sleep(500);
  const rate = from === "USD" && to === "CNY" ? 7.2 : 1;
  return { amount, from, to, result: Math.round(amount * rate * 100) / 100 };
}

export async function getTime({ tz }: { tz: string }) {
  await sleep(500);
  return { tz, iso: new Date().toISOString() };
}

export const toolImpls: Record<string, (args: any) => Promise<unknown>> = {
  getWeather,
  searchProduct,
  convertCurrency,
  getTime,
};

export const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "getWeather",
      description: "查询某城市的实时天气。问天气、冷不冷、要不要带伞时用。",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "城市名" } },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchProduct",
      description: "按关键词搜索商品。想买东西、找商品时用。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "搜索关键词" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convertCurrency",
      description: "货币换算。涉及汇率、把一种货币换成另一种时用。",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          from: { type: "string", description: "源货币代码，如 USD" },
          to: { type: "string", description: "目标货币代码，如 CNY" },
        },
        required: ["amount", "from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTime",
      description: "查询某时区的当前时间。",
      parameters: {
        type: "object",
        properties: { tz: { type: "string", description: "时区，如 Asia/Shanghai" } },
        required: ["tz"],
      },
    },
  },
];
