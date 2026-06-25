// 整个 lab 共用的消息/工具类型。刻意写成「模型无关」的最小形状，
// 让你一眼看清：一条消息无非就这三种角色。

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments 是 JSON 字符串！要 JSON.parse
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

export type ChatMessage =
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

// function calling 的工具定义（就是给函数写 JSON Schema）
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}
