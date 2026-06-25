# 第 5 课：多工具编排（Orchestration）

工具一多，怎么选、怎么并行。

```bash
npm run orchestration
```

> 这一课**配真模型最震撼**（mock 模型不会吐多 tool_call）。

## 三个面试点

1. **怎么选？** 模型靠每个工具的 `description` 路由——**description 写好 = 选路准**。本课有 4 个工具，模型自己挑。
2. **能一次调多个吗？** 能。模型一个回合可以吐出**多个 `tool_call`**。
3. **要串行吗？** 互不依赖就**并行**（`Promise.all`），省时间。

## demo 实测（真 gpt-4o）

问「北京和上海分别多少度？顺便把 100 美元换人民币」，模型一回合吐出 **3 个 tool_call**：

```
🧭 模型这一回合决定调 3 个工具: getWeather, getWeather, convertCurrency  → 并行执行！
  🔧 getWeather({"city":"北京"})          [+0ms → +506ms]
  🔧 getWeather({"city":"上海"})          [+0ms → +507ms]
  🔧 convertCurrency({100, USD, CNY})    [+0ms → +507ms]
⏱ 3 个工具总墙钟 507ms（串行约需 1500ms，并行省下约 993ms）
```

三个工具**同时起跑**，总耗时 ≈ 单个，而不是三个相加。

## 面试一句话

> 工具选择靠 description 做语义路由；模型一个回合能并行请求多个工具；
> runtime 对互不依赖的 tool_call 用 Promise.all 并行执行，显著降低墙钟时间。
> 有依赖关系的（B 需要 A 的结果）才串行，或交给更上层的 planner 编排。
