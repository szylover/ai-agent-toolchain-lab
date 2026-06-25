// ──────────────────────────────────────────────────────────────────────────
// 第 3 课：失败处理（Resilience）—— 工具调用不可靠，怎么办？
//
// 这一课【不需要】模型也能讲清楚：失败处理全发生在 runtime 的「执行工具」那一层。
// 这正是你前端最熟的活：请求超时、指数退避重试、兜底降级。换个壳就是 agent robustness。
//
// 三板斧（面试高频）：
//   1. 超时控制 timeout —— 工具卡住不能让整个 agent 跟着卡死。
//   2. 指数退避重试 retry with backoff —— 抖动型故障，重试往往就好了。
//   3. 兜底降级 fallback —— 重试到头还失败，给个安全的默认值，别让流程崩。
//
// 跑法：npm run resilience
// ──────────────────────────────────────────────────────────────────────────

const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── 一个「不可靠」的工具：用计数器脚本化故障，保证 demo 每次都能演全所有路径 ──
//    （真实世界里就是：网络抖动、下游 5xx、限流、慢查询……）
let weatherAttempt = 0;
async function getWeatherFlaky({ city }: { city: string }): Promise<{ city: string; temp: number }> {
  weatherAttempt++;
  if (weatherAttempt === 1) {
    // 第 1 次：卡住不返回（模拟超时）
    await sleep(10_000);
    return { city, temp: 18 };
  }
  if (weatherAttempt === 2) {
    // 第 2 次：抛错（模拟下游 5xx）
    throw new Error("upstream 503 Service Unavailable");
  }
  // 第 3 次：成功
  return { city, temp: 18 };
}

// 一个「永远挂」的工具：用来演示「重试到头 → 降级兜底」
async function getStockAlwaysDown(): Promise<{ price: number }> {
  throw new Error("stock service down");
}

// ── 板斧 1：给任意 Promise 套一个超时 ────────────────────────────────────────
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

interface ResilienceOpts<T> {
  timeoutMs: number;
  maxRetries: number;
  fallback: T; // 兜底值：所有重试都失败时返回它
}

// ── 把「超时 + 重试 + 降级」打包成一个执行器（runtime 的核心能力）────────────
async function callWithResilience<T>(
  name: string,
  fn: () => Promise<T>,
  opts: ResilienceOpts<T>
): Promise<T> {
  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      log(`  ▶ [${name}] 第 ${attempt} 次尝试（超时上限 ${opts.timeoutMs}ms）`);
      const result = await withTimeout(fn(), opts.timeoutMs);
      log(`  ✅ [${name}] 第 ${attempt} 次成功:`, JSON.stringify(result));
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      const isLast = attempt === opts.maxRetries + 1;
      log(`  ✖ [${name}] 第 ${attempt} 次失败: ${msg}`);

      if (isLast) {
        // 板斧 3：重试到头 → 降级兜底，绝不让整个 agent 崩
        log(`  🛟 [${name}] 重试用尽，降级返回兜底值:`, JSON.stringify(opts.fallback));
        return opts.fallback;
      }

      // 板斧 2：指数退避 + 抖动（避免重试风暴打垮下游）
      const backoff = Math.round(200 * 2 ** (attempt - 1) + Math.random() * 100);
      log(`  ⏳ [${name}] ${backoff}ms 后退避重试…`);
      await sleep(backoff);
    }
  }
  return opts.fallback; // 理论到不了，类型完备性
}

// ── 跑两个场景 ──────────────────────────────────────────────────────────────
async function main() {
  log("=== 第 3 课：失败处理（Resilience）===\n");

  log("场景 A：天气服务先超时、再报错、第三次才成功（重试救场）");
  const weather = await callWithResilience(
    "getWeather",
    () => getWeatherFlaky({ city: "北京" }),
    { timeoutMs: 1_000, maxRetries: 3, fallback: { city: "北京", temp: 20 } }
  );
  log("→ 最终拿到天气:", JSON.stringify(weather), "\n");

  log("场景 B：股价服务彻底挂了（重试到头 → 降级兜底）");
  const stock = await callWithResilience("getStock", () => getStockAlwaysDown(), {
    timeoutMs: 1_000,
    maxRetries: 2,
    fallback: { price: -1 }, // 约定的「不可用」标记，让上层能识别并友好提示
  });
  log("→ 最终拿到股价:", JSON.stringify(stock), "\n");

  log("👉 复盘：失败处理全在 runtime 的工具执行层，模型完全不参与。");
  log("   面试三连：超时（别被拖死）→ 退避重试（抖动型故障）→ 降级兜底（永不崩）。");
}

await main();

export {};
