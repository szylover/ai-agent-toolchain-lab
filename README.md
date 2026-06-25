# AI Agent 工具链实验室 · ai-agent-toolchain-lab

> 一个**真正跑得起来**的 AI Agent 工具链 demo，面向**前端工程师**的面试突击。
> 两个阶段、全程可观测，把 **Function Calling** 和 **MCP 三层翻译**从「听说过」变成「亲手跑过」。

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

### 不配 key 也能跑（mock 模型，零成本）
直接运行，`lib/azure.mjs` 会自动退化成规则模拟的「假模型」：

```bash
npm run fc     # 第 1 课：function calling
npm run mcp    # 第 2 课：MCP 三层翻译
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

## 两个阶段

### `01-function-calling/` — 让模型调用你的函数
最小闭环：模型读工具的 `description` → 自己决定调哪个、怎么填参数 → 你执行 → 回填 → 模型总结。
**看点**：模型只「返回意图」，真正执行的是你的代码。
详见 [`01-function-calling/README.md`](01-function-calling/README.md)。

### `02-mcp/` — 把「三层翻译」演出来
一个**真正的 MCP server**（`server.mjs`，里面**没有任何 LLM**）+ 一个 **MCP client / runtime**（`client.mjs`）。
运行后看 stderr 日志，你会**亲眼**看到：
- ① server 全程只收**结构化参数**，从不碰自然语言、也没有模型；
- ③ 模型全程只见 `tools` 字段，**「MCP」这个词从没进过它的视野**；
- ② runtime 是中间的**翻译官 + 执行者**：`tools/list` 发现工具、翻译成模型格式、`tools/call` 真正执行。

详见 [`02-mcp/README.md`](02-mcp/README.md)。

---

## 面试一句话总结

> 模型只感知到一组 `tools`，吐出结构化的 tool call；runtime 拦截它，通过 MCP 的 `tools/call` 去请求对应的 server——这一步类似发一个 REST 请求；server 返回结果后，runtime 把它作为 tool message 拼回上下文，再让模型生成最终回答。
> **模型全程不知道 MCP 的存在，它只跟 function calling 打交道。** 正是这种透明带来了解耦：换工具来源不用改模型，换模型不用改工具。

---

## 目录结构

```
ai-agent-toolchain-lab/
├── lib/azure.mjs            # 共享模型调用层（真 Azure / mock 自动切换 + .env 加载）
├── 01-function-calling/
│   ├── demo.mjs             # Agent 循环 + function calling
│   └── README.md
├── 02-mcp/
│   ├── server.mjs           # 真 MCP server（无 LLM 的哑执行器）
│   ├── client.mjs           # MCP client + LLM 桥接，演示三层
│   └── README.md
├── .env.example             # 配置模板（复制成 .env 填真值）
└── package.json
```

MIT License.
