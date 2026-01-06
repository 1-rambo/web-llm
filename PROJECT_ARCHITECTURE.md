# WebLLM 项目架构文档

## 📌 项目定位

**WebLLM** = 浏览器中的 LLM 推理引擎 (TypeScript/JavaScript 框架)

- **目标用户**: Web开发者
- **核心价值**: 无需服务器，在浏览器中运行大语言模型
- **对标产品**: OpenAI API (完全兼容其接口)
- **技术栈**: TypeScript + WebGPU + WebAssembly

---

## 🏗️ 技术栈分层

```
┌──────────────────────────────────────────────────────┐
│ 用户应用层 (Your Web App)                             │
│  - 调用 CreateMLCEngine()                            │
│  - 使用 engine.chat.completions.create()             │
└──────────────────────────────────────────────────────┘
                         ↓ 依赖
┌──────────────────────────────────────────────────────┐
│ WebLLM 框架 (本项目)                                   │
│  - NPM包: @mlc-ai/web-llm                            │
│  - 语言: TypeScript                                   │
│  - 编译产物: lib/*.js + lib/*.d.ts                    │
└──────────────────────────────────────────────────────┘
                         ↓ 依赖
┌──────────────────────────────────────────────────────┐
│ TVM Runtime (底层运行时)                               │
│  - NPM包: @mlc-ai/web-runtime                        │
│  - 来源: Apache TVM (C++ 编译成 WASM)                 │
│  - 作用: GPU 计算引擎                                  │
└──────────────────────────────────────────────────────┘
                         ↓ 调用
┌──────────────────────────────────────────────────────┐
│ 浏览器 WebGPU API                                      │
│  - navigator.gpu.requestAdapter()                    │
│  - device.createBuffer() / queue.submit()            │
└──────────────────────────────────────────────────────┘
                         ↓ 控制
┌──────────────────────────────────────────────────────┐
│ GPU 硬件 (NVIDIA/AMD/Intel/Apple)                     │
└──────────────────────────────────────────────────────┘
```

---

## 📦 内部模块架构

### **核心模块** (src/)

```
src/
├── engine.ts              🎯 核心引擎 (MLCEngine 类)
│   ├── CreateMLCEngine()  → 工厂函数
│   ├── reload()           → 加载模型
│   ├── chat.*             → OpenAI 兼容接口
│   └── unload()           → 卸载模型
│
├── llm_chat.ts            🧠 推理管线 (LLMChatPipeline)
│   ├── prefillStep()      → Prefill 阶段
│   ├── decodeStep()       → Decode 阶段
│   ├── embedAndForward()  → 核心计算逻辑
│   └── PagedKVCache       → KV 缓存管理
│
├── conversation.ts        💬 对话管理
│   ├── Conversation       → 对话历史
│   └── getConversation()  → 获取 prompt 模板
│
├── config.ts              ⚙️ 配置管理
│   ├── prebuiltAppConfig  → 预置模型列表
│   ├── ChatConfig         → 聊天配置
│   └── GenerationConfig   → 生成参数
│
├── cache_util.ts          💾 缓存管理
│   ├── fetchNDArrayCache() → 下载模型权重
│   └── ArtifactCache      → IndexedDB/Cache API
│
├── support.ts             🛠️ 工具函数
├── types.ts               📝 类型定义
└── error.ts               ⚠️ 错误处理
```

### **扩展模块** (Worker 支持)

```
src/
├── web_worker.ts          🔧 Web Worker 支持
│   ├── WebWorkerMLCEngine
│   └── WebWorkerMLCEngineHandler
│
├── service_worker.ts      📡 Service Worker 支持
│   ├── ServiceWorkerMLCEngine
│   └── ServiceWorkerMLCEngineHandler
│
└── extension_service_worker.ts  🔌 Chrome Extension 支持
```

### **协议实现** (OpenAI 兼容)

```
src/openai_api_protocols/
├── chat.ts                → ChatCompletion API
├── completion.ts          → Completion API
├── embedding.ts           → Embedding API
└── index.ts               → 类型导出
```

---

## 🔄 数据流与模块交互

### **1. 模型加载流程**

```
用户调用 CreateMLCEngine("Llama-3.2-1B")
    ↓
engine.reload(modelId)
    ├─→ config.ts: 查找模型配置
    ├─→ cache_util.ts: 下载 WASM + 模型权重
    ├─→ @mlc-ai/web-runtime: 实例化 TVM
    └─→ llm_chat.ts: 创建 LLMChatPipeline
         └─→ 初始化 KVCache
```

### **2. 推理执行流程**

```
用户调用 engine.chat.completions.create({messages})
    ↓
engine.ts: chatCompletion()
    ├─→ conversation.ts: 构建 prompt
    ├─→ llm_chat.ts: prefillStep()
    │    ├─→ tokenizer.encode()
    │    ├─→ embedAndForward()
    │    │    ├─→ this.embed() (TVM函数)
    │    │    ├─→ this.prefill() (TVM函数, GPU计算)
    │    │    └─→ 更新 KVCache
    │    └─→ 返回 logits
    ├─→ llm_chat.ts: decodeStep() (循环)
    │    └─→ this.decoding() (TVM函数, GPU计算)
    └─→ 返回 ChatCompletion 对象
```

### **3. Worker 模式数据流**

```
主线程 (main.ts)
    ↓ postMessage
Worker 线程 (worker.ts)
    ├─→ WebWorkerMLCEngineHandler
    ├─→ 内部持有 MLCEngine 实例
    └─→ 执行推理
         ↓ postMessage (结果)
主线程
    └─→ 收到结果并渲染
```

---

## 五、Prefill 与 Decode 阶段详细对比

### 5.1 核心流程概述

在 LLM 推理过程中，有两个关键阶段：

1. **Prefill 阶段**：处理完整的用户输入提示词（prompt），一次性计算所有 token 的 KV Cache
2. **Decode 阶段**：自回归生成，每次只处理上一步生成的单个 token

这两个阶段都在 `src/llm_chat.ts` 的 `LLMChatPipeline` 类中实现。

### 5.2 共同步骤（Shared Pipeline）

两个阶段共享以下核心流程：

```
embedAndForward() → sampleTokenFromLogits() → processNextToken()
```

#### 共同组件详解

1. **embedAndForward()**（lines 1053-1119）
   - 职责：将输入数据（token IDs 或图像）嵌入后送入模型前向传播
   - 输入：`inputData` (Array<Array<number> | ImageURL>)
   - 输出：logits (tvmjs.Tensor，在 GPU 上)
   - 核心操作：
     ```typescript
     // 步骤1: 嵌入所有输入数据（文本token或图像）
     embeddings.push(this.getTokensEmbeddings(tokenIds));
     embeddings.push(await this.getImageEmbeddings(imageUrl));
     
     // 步骤2: 拼接所有嵌入
     allEmbeddings = this.tvm.concatEmbeddings(embeddings);
     
     // 步骤3: 调用前向传播函数（根据长度选择 prefill 或 decoding）
     this.fKVCacheBeginForward!(this.kvCache, seqIdsTuple, inputLenShape);
     if (inputDataLen > 1) {
       retValue = this.prefill(allEmbeddings, this.kvCache, this.params);
     } else {
       retValue = this.decoding(allEmbeddings, this.kvCache, this.params);
     }
     this.fKVCacheEndForward!(this.kvCache);
     
     // 步骤4: 更新已填充的 KVCache 长度
     this.filledKVCacheLength += inputDataLen;
     ```
   - **关键点**：这里通过 `inputDataLen > 1` 判断调用 `prefill()` 还是 `decoding()` 函数
   - **KVCache 写入**：每次调用后 `filledKVCacheLength` 增加，表示 KVCache 在 GPU 上累积增长

2. **sampleTokenFromLogits()**（lines 1121-1300+）
   - 职责：从模型输出的 logits 中采样下一个 token
   - 输入：logitsOnGPU (tvmjs.Tensor), genConfig (GenerationConfig)
   - 输出：sampled token ID
   - 核心操作：
     - 应用 temperature、top_p、repetition_penalty、frequency_penalty 等采样策略
     - 支持 JSON mode 的 grammar bitmask（通过 `grammarMatcher.getNextTokenBitmask()`）
     - 支持 logit_bias、logitProcessor 等自定义逻辑处理
     - 最终调用 TVM 的采样函数生成 token

3. **processNextToken()**（lines 870-900）
   - 职责：处理采样到的 token，更新对话状态
   - 核心操作：
     - 检查停止条件（max_tokens、stop_strings）
     - 更新 `outputIds` 和 `outputMessage`
     - 判断是否应该停止生成

### 5.3 Prefill 阶段独有特性

**方法**：`prefillStep()`（lines 686-825）

#### Prefill 特有步骤

1. **Grammar Matcher 初始化**（仅在首次 prefill 时）
   ```typescript
   if (genConfig?.response_format?.type === "json_object" && 
       this.grammarMatcher === undefined) {
     this.grammarMatcher = await this.grammarFactory!.getGrammarForJSONSchema(
       genConfig.response_format.schema
     );
   }
   ```

2. **获取完整输入数据**
   ```typescript
   const inputData: Array<Array<number> | ImageURL> = 
     this.getPrefillInputDataAndImage();
   ```
   - 将完整的对话历史转换为 token IDs 或图像数据
   - 包含系统提示、历史消息、当前用户输入

3. **分块处理（Chunking）**
   ```typescript
   for (let i = 0; i < inputData.length; i += curChunk.length) {
     curChunk = [];
     curChunkLen = 0;
     for (let j = i; j < inputData.length; j++) {
       if (curChunkLen + dataLen > this.prefillChunkSize) break;
       curChunk.push(inputData[j]);
       curChunkLen += dataLen;
     }
     logitsOnGPU = await this.embedAndForward(curChunk, curChunkLen);
   }
   ```
   - 原因：避免单次前向传播输入过长导致 OOM
   - 每个 chunk 大小 ≤ `prefillChunkSize`（配置项，如 2048）
   - 每个 chunk 调用一次 `embedAndForward()`

4. **仅对最后一个 chunk 的 logits 采样**
   ```typescript
   // 只在所有 chunk 处理完后才采样第一个生成的 token
   const firstSampleToken = await this.sampleTokenFromLogits(logitsOnGPU, genConfig);
   ```

5. **统计信息**
   - `prefillTotalTime`：总 prefill 时间
   - `prefillTotalTokens`：处理的 token 总数
   - `filledKVCacheLength` 在所有 chunk 累加后的最终值

#### Prefill 的性能特点

- **批量处理**：一次性处理大量 token（如 512、1024 等）
- **GPU 高吞吐**：可以充分利用 GPU 的并行计算能力
- **KVCache 写入密集**：所有输入 token 的 K、V 向量都要写入 GPU VRAM
- **时间占比**：通常占首次推理延迟的大头（如 70%-90%）

### 5.4 Decode 阶段独有特性

**方法**：`decodeStep()`（lines 827-868）

#### Decode 特有步骤

1. **单 token 输入**
   ```typescript
   const inputData = [this.outputIds.slice(-1)]; // 只取最后一个 token
   ```
   - 每次只处理上一步生成的 1 个 token
   - 不需要分块，直接传入

2. **简化的前向传播**
   ```typescript
   const logitsOnGPU = await this.embedAndForward(inputData, 1);
   ```
   - `inputDataLen = 1`，在 `embedAndForward()` 内部会调用 `decoding()` 函数（而非 `prefill()`）
   - 逻辑分支：`if (inputDataLen > 1) {...} else { decoding(...) }`

3. **立即采样并处理**
   ```typescript
   const nextToken = await this.sampleTokenFromLogits(logitsOnGPU, genConfig);
   await this.processNextToken(nextToken, ...);
   ```
   - 每步生成 1 个 token
   - Grammar matcher 在 prefill 时已初始化，这里直接复用

4. **统计信息**
   - `decodingTotalTime`：累计解码时间
   - `decodingTotalTokens`：累计生成的 token 数
   - `filledKVCacheLength` 每步 +1

#### Decode 的性能特点

- **自回归**：必须串行生成，每个 token 依赖前一个
- **GPU 利用率低**：单 token 计算无法充分利用 GPU 并行能力
- **KVCache 读取密集**：需要读取之前所有 token 的 KV Cache（Attention 机制）
- **时间占比**：长文本生成时占总时间的大头（生成 100 token 需要 100 次 decode）



