# AI Agent 工具链实验室 · ai-agent-toolchain-lab

> 一个**真正跑得起来**的 AI Agent 工具链 demo，面向**前端工程师**的面试突击。
> 五课循序渐进、全程可观测，把 **Function Calling、MCP 三层翻译、失败处理、可观测性、多工具编排**从「听说过」变成「亲手跑过」。

如果你能对着这个 repo 把下面这张图讲清楚，tool chain 面试的核心就稳了：

```
①  MCP server        "我有 getWeather"          ← 只有这层懂 MCP / JSON-RPC（无 LLM！）
        ↑ tools/list
②  runtime / client  收集 + 翻译成 function schema  ← 翻译官 + 执行者，既懂 MCP 又懂模型
        ↓ 塞进 tools 字段
③  LLM               "我有个 getWeather 能调"     ← 只懂 function calling，【不知道 MCP 存在】
```

---

## 一句话世界观（前端类比）

> **LLM 是一个只会读 props 的纯函数组件**：输入 `messages + tools`，输出一条消息——
> 要么是最终答案 (`content`)，要么是「我想调某个工具」的意图 (`tool_calls`)。
> 它**从不自己执行工具**，也**不知道工具是从 MCP 来的还是写死的**，它只认传进来的 `tools` 这个 prop。

| AI Agent 概念 | 前端类比 |
| --- | --- |
| LLM 只吐意图、不碰副作用 | React 组件只描述 UI，不直接操作 DOM |
| Agent 循环（吐 call → 执行 → 回填 → 再吐） | Redux：dispatch → reducer → 新 state → re-render |
| JSON Schema 约束工具参数 | Zod / TS 类型给函数签名 |
| MCP server 的工具处理器 | Express 的路由 handler |
| MCP（统一发现/调用工具的协议） | npm / 服务发现：统一怎么找到并调用「能力」 |
| 工具结果回填给模型 (`role:"tool"`) | ReAct 里的 Observation |
| 最大步数 / 超时 | 防无限 render / 请求超时 |

---

## 快速开始

```bash
npm install
```

> 需要 Node.js ≥ 20.12（用到内置的 `process.loadEnvFile`）。TypeScript 直接用 `tsx` 跑，免编译。

### 不配 key 也能跑（mock 模型，零成本）
直接运行，`src/lib/llm.ts` 会自动退化成规则模拟的「假模型」：

```bash
npm run fc            # 第 1 课：function calling
npm run mcp           # 第 2 课：MCP 三层翻译
npm run resilience    # 第 3 课：失败处理（超时/重试/降级，不需要 key）
npm run observability # 第 4 课：可观测性（trace_id + span）
npm run orchestration # 第 5 课：多工具编排（选路 + 并行，建议配真模型）
```

### 接真模型（Azure OpenAI）
复制 `.env.example` 为 `.env`，填上你自己的值（`.env` 已被 git 忽略，不会泄露）：

```bash
cp .env.example .env      # Windows: copy .env.example .env
# 编辑 .env 填入 key / endpoint / deployment
npm run fc
npm run mcp
```

> ⚠️ 安全红线：key 等于密码，**不进聊天、不进代码、不进 git**。本仓库通过 `.env` + `.gitignore` 保证 key 永不入库。跑完不放心就去 Azure Portal 把 key rotate 一次。

---

## 五课循序渐进

| # | 课 | 一句话看点 | 需要 key? |
|---|---|---|---|
| 1 | [function calling](src/01-function-calling/README.md) | 模型只「吐意图」，执行权在你 | 可选 |
| 2 | [mcp](src/02-mcp/README.md) | 真 MCP server + 三层翻译，模型不知道 MCP | 可选 |
| 3 | [resilience](src/03-resilience/README.md) | 超时 / 退避重试 / 降级兜底 | 否 |
| 4 | [observability](src/04-observability/README.md) | trace_id + span 调用树 | 可选 |
| 5 | [orchestration](src/05-orchestration/README.md) | 多工具选路 + 并行执行 | 建议配 |

### `src/01-function-calling/` — 让模型调用你的函数
最小闭环：模型读工具的 `description` → 自己决定调哪个、怎么填参数 → 你执行 → 回填 → 模型总结。
**看点**：模型只「返回意图」，真正执行的是你的代码。
详见 [`src/01-function-calling/README.md`](src/01-function-calling/README.md)。

### `src/02-mcp/` — 把「三层翻译」演出来
一个**真正的 MCP server**（`server.ts`，里面**没有任何 LLM**）+ 一个 **MCP client / runtime**（`client.ts`），基于官方 `@modelcontextprotocol/sdk`。
运行后看 stderr 日志，你会**亲眼**看到：
- ① server 全程只收**结构化参数**，从不碰自然语言、也没有模型；
- ③ 模型全程只见 `tools` 字段，**「MCP」这个词从没进过它的视野**；
- ② runtime 是中间的**翻译官 + 执行者**：`tools/list` 发现工具、翻译成模型格式、`tools/call` 真正执行。

详见 [`src/02-mcp/README.md`](src/02-mcp/README.md)。

### `src/03-resilience/` — 工具不可靠怎么办（前端最熟的活）
**超时** → **指数退避重试** → **降级兜底**。失败处理全在 runtime 执行层，模型不参与。面试超高频。
详见 [`src/03-resilience/README.md`](src/03-resilience/README.md)。

### `src/04-observability/` — agent 黑盒怎么排查
**trace_id + span** 调用树，和前端链路追踪 1:1 迁移。一眼看出耗时分布、谁调了谁。
详见 [`src/04-observability/README.md`](src/04-observability/README.md)。

### `src/05-orchestration/` — 工具一多怎么选、怎么并行
模型靠 `description` **选路**；一回合可吐**多个 tool_call**；互不依赖就 `Promise.all` **并行**。
详见 [`src/05-orchestration/README.md`](src/05-orchestration/README.md)。

---

## 面试一句话总结

> 模型只感知到一组 `tools`，吐出结构化的 tool call；runtime 拦截它，通过 MCP 的 `tools/call` 去请求对应的 server——这一步类似发一个 REST 请求；server 返回结果后，runtime 把它作为 tool message 拼回上下文，再让模型生成最终回答。
> **模型全程不知道 MCP 的存在，它只跟 function calling 打交道。** 正是这种透明带来了解耦：换工具来源不用改模型，换模型不用改工具。

---

## 目录结构

```
ai-agent-toolchain-lab/
├── src/
│   ├── lib/
│   │   ├── llm.ts           # 共享模型调用层（真 Azure / mock 自动切换 + .env 加载）
│   │   └── types.ts         # 消息 / 工具的最小类型定义
│   ├── 01-function-calling/ # 第 1 课：function calling
│   ├── 02-mcp/              # 第 2 课：真 MCP server + client，三层翻译
│   ├── 03-resilience/       # 第 3 课：超时 / 重试 / 降级
│   ├── 04-observability/    # 第 4 课：trace_id + span 调用树
│   └── 05-orchestration/    # 第 5 课：多工具选路 + 并行
├── .env.example             # 配置模板（复制成 .env 填真值）
├── tsconfig.json
└── package.json
```

MIT License.
