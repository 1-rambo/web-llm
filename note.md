### 背景
智能化浏览器的使用往往具有连续性，即相邻的若干请求往往共享同一上下文（如网页的 DOM 结构、任务基本 prompt 等）。现有浏览器中的推理引擎往往不考虑缓存，而是针对每个请求重新进行计算。
本研究希望通过在首个推理任务时缓存这些共享的部分，提升推理性能。

### 挑战
- 挑战 1：在受限的浏览器环境中，如何抽象并存储共享上下文？
浏览器端的LLM实例必须在严格受限的GPU显存、JS堆内存和浏览器本地存储配额内工作。我们需要为"共享上下文"在浏览器端定义统一的抽象与分块粒度(例如:系统提示词片段、页面DOM的编码片段、长期任务状态对应的KV片段)，并决定哪些部分常驻浏览器GPU、哪些缓存在浏览器进程的CPU内存，哪些可以落盘至浏览器本地存储。目标是在浏览器这一沙箱环境内，在不破坏推理正确性的前提下，最大化上下文重用率，同时控制整体资源占用。
- 挑战 2：如何在浏览器端以低开销方式加载这些缓存上下文并与推理内核对接？
被缓存的上下文片段在参与下一次推理前，必须从浏览器可用的存储介质搬运回LLM执行位置(例如WebGPU上的KVcache或Wasm内存)。在浏览器缺乏传统OS异步I/O与共享内存机制的前提下，如何设计一套完全运行在前端(JavaScript/WebWorkerWebGPU)内部的加载与绑定流程，使得上下文恢复具有可预期的延迟上界，并避免大块数据拷导致的UI阻塞和主线程卡顿，是第二个核心难题。
- 挑战 3：在浏览器中仅有单模型实例的前提下，如何在多共享上下文之间切换而不退化为频繁prefill？
单个浏览器内的LLM模型需要在多个标签页、多条会话、多智能体之间频繁切换所使用的共享上下文。如果每次上下文切换在浏览器端都退化为"从零开始对完整prompt做prefill"，其端到端延迟将随着活跃上下文数量线性甚至超线性增长。同时，浏览器缺乏进程级上下文切换支持，所有切换逻辑必须在前端运行时自行实现。如何在浏览器端设计一种面向多上下文的KV状态虚拟化机制，在会话切换时尽可能复用已有片段、限制必要的重算范围，并在此基础上支持公平调度与合理的尾延迟，是第三个关键挑战。

### 核心技术方案

#### 技术1：三层存储策略 (挑战1核心)
**目标**: 分层管理KVCache，平衡性能与容量
- **GPU层**: 热数据，零延迟访问，容量3-5个context
- **CPU内存层**: 温数据，50-100ms恢复延迟，容量几十个context
- **IndexedDB层**: 冷数据，跨会话持久化，容量GB级

**需要修改的层级**:
- ✅ **应用层** (shared_context.ts): 实现存储策略管理器，决策数据存放位置
- ✅ **Engine层** (src/engine.ts): 新增API支持GPU缓存删除
- ⚠️ **TVM层** (C++/WASM): (可选) 显式释放GPU Buffer，当前依赖JS GC

**实现方案**: 2A (CPU存序列化KVCache)

---

#### 技术2：资源配额管理 (挑战1核心)
**目标**: 动态监控GPU/CPU资源，自动淘汰过期缓存

**需要修改的层级**:
- ✅ **Engine层** (src/engine.ts): 实现FIFO/LRU淘汰算法；监控GPU内存占用，设置配额上限 (maxGpuCaches)
- ❌ **无需修改底层**: 依赖应用层调度即可

---

#### 技术3：跨介质数据搬运 (挑战2核心)
**目标**: 实现GPU↔CPU↔IndexedDB的KVCache传输，保证延迟上界

**需要修改的层级**:
- ⚠️ **TVM Runtime层** (C++): 序列化/反序列化KVCache (GPU Buffer ↔ ArrayBuffer)
  - `SerializeKVCache()`: GPU → CPU字节数组
  - `DeserializeKVCache()`: CPU字节数组 → GPU
- ⚠️ **TVM JS绑定层** (src/llm_chat.ts): 暴露序列化API给JavaScript
- ✅ **Engine层** (src/engine.ts): 新增 `exportKVCache()` / `importKVCache()`
- ✅ **应用层** (shared_context.ts): 调用上述API，管理数据流转

**数据流**:
```
GPU Buffer → SerializeKVCache() → ArrayBuffer → CPU内存
             ↓ (可选)
          IndexedDB → ArrayBuffer → DeserializeKVCache() → GPU Buffer
```
---

#### 技术4：KV状态虚拟化 (挑战3核心)
**目标**: 多上下文并存，按需加载/卸载，避免频繁prefill

**需要修改的层级**:
- ✅ **应用层** (shared_context.ts): 实现虚拟化管理器
  - 维护上下文状态表 (GPU/CPU/Disk)
  - 切换逻辑: 检查位置 → 必要时迁移 → 更新访问时间
- ✅ **Engine层** (src/engine.ts): 支持动态加载/卸载context
- ❌ **无需修改推理内核**: 复用现有 `saveSharedContext` 机制

---

### 实现建议

#### 1. 扩展 Conversation 类支持共享前缀
- 在 `Conversation` 对象中增加 `sharedPrefix` 字段标识共享的消息
- 修改 `compareConversationObject()` 函数，支持部分匹配（前缀匹配）

#### 2. 扩展 KV Cache 管理
- 在 `LLMChatPipeline` 中增加 `saveKVCacheSnapshot()` 方法保存共享前缀的 KV Cache
- 增加 `loadKVCacheSnapshot()` 方法加载已保存的 KV Cache
- 支持多个命名的 KV Cache 快照，用 Map 结构管理

#### 3. 修改 prefill 逻辑
- 在 `engine.prefill()` 中检查是否存在匹配的共享前缀
- 如果存在，加载对应的 KV Cache 快照，只对新增部分进行 prefill
- 记录当前使用的共享前缀 ID，用于后续请求复用

#### 4. 存储策略
- **短期缓存**：GPU 内存（性能最佳，容量有限）
- **中期缓存**：CPU 内存（容量较大，需要 GPU↔CPU 传输）
- **长期缓存**：IndexedDB（持久化，跨会话复用）

#### 5. 使用示例
```javascript
// 第一次请求：缓存共享前缀
await engine.saveSharedContext("dom_context", [
  { role: "system", content: "你是网页助手" },
  { role: "user", content: "<DOM结构>...</DOM>" }
]);

// 后续请求：复用共享前缀
await engine.chat.completions.create({
  messages: [
    { role: "user", content: "帮我总结这个页面" }
  ],
  shared_context_id: "dom_context"  // 指定复用的共享上下文
});
```

