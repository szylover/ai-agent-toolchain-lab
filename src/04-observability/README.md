# 第 4 课：可观测性（Observability）

agent 是个黑盒，线上出问题怎么排查？答案：**trace_id + span**，和前端链路追踪 1:1 迁移。

```bash
npm run observability
```

## 概念

- 一次用户请求 = 一个 **trace**（唯一 `trace_id`）。
- 每个步骤（调模型、调工具）= 一个 **span**（名字、耗时、父子关系）。
- 跑完打印一棵**调用树**，一眼看出时间花在哪、谁调了谁。

## demo 输出长这样

```
📊 Trace tr_xxxx（调用树）
└─ agent.run  ⏱ 4565ms  {"question":"...","result":"done"}
  └─ llm.call#1  ⏱ 2837ms  {"decided":"tool_call"}
  └─ tool.getWeather  ⏱ 0ms  {"ok":true}
  └─ llm.call#2  ⏱ 1728ms  {"decided":"final"}
```

一眼看出：**两次模型调用占了绝大部分耗时**，工具本身几乎不耗时。这就是优化的依据。

## 面试一句话

> 给每次请求分配 trace_id，把调模型、调工具都包成 span 记录耗时和父子关系，
> 落到日志/APM（如 OpenTelemetry / LangSmith）。排查时按 trace_id 捞整条链路，
> 比满屏 console.log 强一个量级。
