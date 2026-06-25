# 第 5 课：多工具编排（Orchestration）

工具一多，怎么选、怎么并行、**有依赖怎么办**。本课两个文件：

```bash
npm run orchestration   # demo.ts：模型驱动的多回合循环（一回合并行）
npm run dag             # dag.ts：plan-then-execute，DAG 拓扑调度（处理依赖）
```

> 这一课**配真模型最震撼**（mock 模型不会吐多 tool_call / 规划 DAG）。

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

---

## 进阶：有依赖怎么办？两种通用方案

### 方案 A：模型驱动的多回合循环（`demo.ts`）
模型**不会**在一回合吐出有依赖的 B（因为 B 的参数还不知道）。它走一步看一步：
回合 1 调 A → 结果回填（Observation）→ 回合 2 才调 B。依赖靠**多回合**天然串起来。
- 优点：灵活，能临场改计划；缺点：每步一次 LLM 往返，**慢且烧 token**。

### 方案 B：plan-then-execute / DAG（`dag.ts`，业界通用，如 LLMCompiler）
模型**先一次性**产出一张带依赖的计划图，runtime 再拓扑调度（这一步**零 LLM**）。

**数据结构**就是给每个 function-call 节点加一个「前置依赖」字段（你说的 pre-node）：

```ts
interface PlanNode {
  id: string;                      // "n1"
  tool: string;                    // 工具名
  args: Record<string, unknown>;   // 值可含占位符，如 "${n1.temp}"
  dependsOn: string[];             // 前置节点：它们 finished 后本节点才能跑
}
```

参数用占位符 `${上游id.字段}` 引用上游输出；调度器解析占位符 + 拓扑排序：

```
① 规划（一次 LLM）：
   n1 getWeather(北京)            dependsOn []
   n2 getWeather(上海)            dependsOn []
   n3 convertCurrency(${n1.temp}) dependsOn [n1]   ← 金额来自 n1 的气温
② 执行（runtime 调度，无 LLM）：
   🌊 第 1 波并行: n1, n2          [+0 → +506ms]
   🌊 第 2 波:     n3 (amount=18)  [+506 → +1009ms]   ← ${n1.temp} 解析成 18
   ⏱ 墙钟 1010ms（全串行需 1500ms）
```

### 怎么选（面试答这个满分）

| | 模型驱动循环（A） | Planner / DAG（B） |
|---|---|---|
| 依赖处理 | 多回合，走一步看一步 | 先出依赖图，runtime 拓扑调度 |
| LLM 调用 | 多（每步一次） | 少（只规划一次） |
| 灵活性 | 高（能临场改） | 低（计划定死） |
| 适合 | 探索性、不确定的任务 | 流程固定、要省钱提速 |

> 面试一句话：无依赖的工具一回合并行；有依赖的，要么靠 agent 循环多回合串（灵活但费 token），
> 要么用 planner 先生成 DAG（节点带 `dependsOn` + 占位符引用上游输出）再拓扑调度（省 LLM、并行更充分，但不灵活）。

