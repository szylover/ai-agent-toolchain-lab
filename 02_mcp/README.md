# 第 2 课：MCP 三层翻译

一个**真正的 MCP server** + 一个 **MCP client / runtime**（官方 `mcp` Python SDK），把你最容易搞混的「三层」演出来。

```bash
python 02_mcp/client.py
```

> 你**不用单独启动 server**。`client.py` 会用 stdio transport 把 `server.py` 当子进程拉起来。

## 三层是谁、各懂什么

```
①  MCP server (server.py)    "我有 getWeather"           ← 唯一懂 MCP/JSON-RPC，【没有 LLM】
        ↑ tools/list
②  runtime (client.py)       发现 + 翻译 + 执行            ← 翻译官，既懂 MCP 又懂模型格式
        ↓ 塞进 tools 字段
③  LLM (lib/llm.py)          "我有个工具能调"              ← 只懂 function calling，【不知道 MCP】
```

## 运行后看 stderr 日志，验证三个结论

1. **① server 里没有任何 LLM。**
   `server.py` 收到的是 `getWeather(city=北京)` 这种**结构化参数**，不是自然语言。
   它就是个「哑」的确定性执行器 —— 像 FastAPI 后端。

2. **③ 模型从没见过「MCP」。**
   runtime 把 MCP 的 `inputSchema` 翻译成模型的 function calling 格式后才发给模型。
   发给模型的请求里只有 `tools:[...]`，**没有 "MCP" 字样**。

3. **② runtime 才是干活的。**
   模型只吐一个 `tool_call`，**真正去 `tools/call` 请求 server 的是 runtime**。
   模型自己一个网络请求都发不出去。

## 为什么这样设计才对

正因为模型不知道 MCP：

- 今天用 MCP 接工具、明天换成写死、后天换成 OpenAPI —— **模型代码一行不用改**；
- 同一个 MCP server 也能喂给任何模型（GPT / Claude / 本地模型）—— 中间 runtime 负责翻译。

这就是**解耦**：MCP 管「工具侧标准化」，function calling 管「模型侧表达」，runtime 做翻译。
三者互不知道对方内部细节，所以可以自由替换。

## 协议细节（面试加分）

MCP 底层是 **JSON-RPC 2.0**，常见 transport 有 `stdio`（本地子进程，本 demo 用的）和 `Streamable HTTP`。
一次会话的关键消息：
- `initialize` —— 握手、交换能力（`session.initialize()` 背后自动做）
- `tools/list` —— 发现有哪些工具
- `tools/call` —— 真正调用某个工具
