import * as webllm from "@mlc-ai/web-llm";

let engine: webllm.MLCEngine;

// DOM elements
const statusEl = document.getElementById("status")!;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const runWithCache = document.getElementById("runWithCache") as HTMLButtonElement;
const runWithoutCache = document.getElementById("runWithoutCache") as HTMLButtonElement;
const sharedContextEl = document.getElementById("sharedContext") as HTMLTextAreaElement;
const contextIdEl = document.getElementById("contextId") as HTMLInputElement;
const task1El = document.getElementById("task1") as HTMLTextAreaElement;
const task2El = document.getElementById("task2") as HTMLTextAreaElement;
const saveOutputEl = document.getElementById("saveOutput")!;
const taskOutputEl = document.getElementById("taskOutput")!;
const perfOutputEl = document.getElementById("perfOutput")!;

// Performance tracking
let saveTime = 0;
let withCacheTask1Time = 0;
let withCacheTask2Time = 0;
let withCacheTotalTime = 0;
let withoutCacheTask1Time = 0;
let withoutCacheTask2Time = 0;
let withoutCacheTotalTime = 0;

// Token counts for fair comparison (completion tokens only)
let withCacheTask1Tokens = 0;
let withCacheTask2Tokens = 0;
let withoutCacheTask1Tokens = 0;
let withoutCacheTask2Tokens = 0;

function setStatus(message: string, type: "loading" | "success" | "error") {
  statusEl.textContent = message;
  statusEl.className = type;
}

async function initEngine() {
  try {
    setStatus("Loading model... (This may take a few minutes)", "loading");
    
    engine = await webllm.CreateMLCEngine(
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      {
        logLevel: "INFO", // Enable INFO level logging to see debug messages
        initProgressCallback: (progress) => {
          setStatus(`Loading: ${progress.text} (${Math.round(progress.progress * 100)}%)`, "loading");
        },
      }
    );
    
    setStatus("✅ Engine ready! You can now save shared context.", "success");
    saveBtn.disabled = false;
  } catch (error) {
    setStatus(`❌ Error: ${error}`, "error");
    console.error(error);
  }
}

// Save shared context
saveBtn.onclick = async () => {
  const contextText = sharedContextEl.value.trim();
  const ctxId = contextIdEl.value.trim();
  
  if (!contextText) {
    alert("Please enter shared context text");
    return;
  }
  
  if (!ctxId) {
    alert("Please enter a context ID");
    return;
  }
  
  try {
    saveBtn.disabled = true;
    saveOutputEl.textContent = "Saving shared context...";
    setStatus("Processing shared context...", "loading");
    
    console.log("=== SAVE CONTEXT START ===");
    console.log("Context ID:", ctxId);
    console.log("Context text length:", contextText.length);
    
    const startTime = performance.now();
    
    // Save shared context using the new API
    await engine.saveSharedContext(ctxId, [
      {
        role: "system",
        content: contextText,
      },
      {
        role: "user",
        content: "Hi",
      },
    ]);
    
    const endTime = performance.now();
    saveTime = (endTime - startTime) / 1000;
    
    console.log("=== SAVE CONTEXT COMPLETE ===");
    console.log("Save time:", saveTime, "seconds");
    
    saveOutputEl.textContent = `✅ Shared context "${ctxId}" saved successfully!\nTime: ${saveTime.toFixed(3)}s`;
    setStatus("✅ Shared context saved! You can now run tasks.", "success");
    
    runWithCache.disabled = false;
    runWithoutCache.disabled = false;
    saveBtn.disabled = false;
  } catch (error) {
    saveOutputEl.textContent = `❌ Error: ${error}`;
    setStatus(`❌ Error saving context: ${error}`, "error");
    console.error(error);
    saveBtn.disabled = false;
  }
};

// Run both tasks WITH cache
runWithCache.onclick = async () => {
  const task1Text = task1El.value.trim();
  const task2Text = task2El.value.trim();
  const ctxId = contextIdEl.value.trim();
  
  if (!task1Text || !task2Text) {
    alert("Please enter both task texts");
    return;
  }
  
  try {
    runWithCache.disabled = true;
    runWithoutCache.disabled = true;
    taskOutputEl.textContent = "🚀 Running both tasks WITH cache...\n";
    setStatus("Running tasks with shared context cache...", "loading");
    
    const totalStartTime = performance.now();
    
    // Task 1 with cache
    taskOutputEl.textContent += "\n📝 Task 1: Processing...";
    const task1Start = performance.now();
    const response1 = await engine.chat.completions.create({
      messages: [{ role: "user", content: task1Text }],
      max_tokens: 150,
      extra_body: { shared_context_id: ctxId },
    });
    const task1End = performance.now();
    withCacheTask1Time = (task1End - task1Start) / 1000;
    const task1Result = response1.choices[0].message.content || "";
    const task1Prefill = response1.usage?.extra?.time_to_first_token_s || 0;
    withCacheTask1Tokens = response1.usage?.completion_tokens || 0;  // 记录输出 token 数
    
    taskOutputEl.textContent += `\n✅ Task 1 completed (${withCacheTask1Time.toFixed(3)}s, prefill: ${task1Prefill.toFixed(3)}s, tokens: ${withCacheTask1Tokens})`;
    
    // Task 2 with cache
    taskOutputEl.textContent += "\n\n📝 Task 2: Processing...";
    const task2Start = performance.now();
    const response2 = await engine.chat.completions.create({
      messages: [{ role: "user", content: task2Text }],
      max_tokens: 150,
      extra_body: { shared_context_id: ctxId },
    });
    const task2End = performance.now();
    withCacheTask2Time = (task2End - task2Start) / 1000;
    const task2Result = response2.choices[0].message.content || "";
    const task2Prefill = response2.usage?.extra?.time_to_first_token_s || 0;
    withCacheTask2Tokens = response2.usage?.completion_tokens || 0;  // 记录输出 token 数
    
    const totalEndTime = performance.now();
    withCacheTotalTime = (totalEndTime - totalStartTime) / 1000;
    
    taskOutputEl.textContent = `✅ WITH Cache Results:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Task 1 (${withCacheTask1Time.toFixed(3)}s):
${task1Result.substring(0, 150)}${task1Result.length > 150 ? '...' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Task 2 (${withCacheTask2Time.toFixed(3)}s):
${task2Result.substring(0, 150)}${task2Result.length > 150 ? '...' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️  Timing Breakdown:
• Save Context: ${saveTime.toFixed(3)}s
• Task 1: ${withCacheTask1Time.toFixed(3)}s (prefill: ${task1Prefill.toFixed(3)}s)
• Task 2: ${withCacheTask2Time.toFixed(3)}s (prefill: ${task2Prefill.toFixed(3)}s)
• Total (save + tasks): ${(saveTime + withCacheTotalTime).toFixed(3)}s

📊 Token Usage:
• Task 1: ${withCacheTask1Tokens} tokens
• Task 2: ${withCacheTask2Tokens} tokens
• Total: ${withCacheTask1Tokens + withCacheTask2Tokens} tokens`;
    
    setStatus("✅ Both tasks with cache completed!", "success");
    runWithCache.disabled = false;
    runWithoutCache.disabled = false;
    
    updatePerfComparison();
  } catch (error) {
    taskOutputEl.textContent = `❌ Error: ${error}`;
    setStatus(`❌ Error: ${error}`, "error");
    console.error(error);
    runWithCache.disabled = false;
    runWithoutCache.disabled = false;
  }
};

// Run both tasks WITHOUT cache
runWithoutCache.onclick = async () => {
  const task1Text = task1El.value.trim();
  const task2Text = task2El.value.trim();
  const contextText = sharedContextEl.value.trim();
  
  if (!task1Text || !task2Text) {
    alert("Please enter both task texts");
    return;
  }
  
  try {
    runWithCache.disabled = true;
    runWithoutCache.disabled = true;
    taskOutputEl.textContent = "🐌 Running both tasks WITHOUT cache (baseline)...\n";
    setStatus("Running tasks without cache (full prefill each time)...", "loading");
    
    const totalStartTime = performance.now();
    
    // Task 1 without cache
    taskOutputEl.textContent += "\n📝 Task 1: Processing...";
    const task1Start = performance.now();
    const response1 = await engine.chat.completions.create({
      messages: [
        { role: "system", content: contextText },
        { role: "user", content: task1Text },
      ],
      max_tokens: 150,
    });
    const task1End = performance.now();
    withoutCacheTask1Time = (task1End - task1Start) / 1000;
    const task1Result = response1.choices[0].message.content || "";
    const task1Prefill = response1.usage?.extra?.time_to_first_token_s || 0;
    withoutCacheTask1Tokens = response1.usage?.completion_tokens || 0;  // 记录输出 token 数
    
    taskOutputEl.textContent += `\n✅ Task 1 completed (${withoutCacheTask1Time.toFixed(3)}s, prefill: ${task1Prefill.toFixed(3)}s, tokens: ${withoutCacheTask1Tokens})`;
    
    // Task 2 without cache
    taskOutputEl.textContent += "\n\n📝 Task 2: Processing...";
    const task2Start = performance.now();
    const response2 = await engine.chat.completions.create({
      messages: [
        { role: "system", content: contextText },
        { role: "user", content: task2Text },
      ],
      max_tokens: 150,
    });
    const task2End = performance.now();
    withoutCacheTask2Time = (task2End - task2Start) / 1000;
    const task2Result = response2.choices[0].message.content || "";
    const task2Prefill = response2.usage?.extra?.time_to_first_token_s || 0;
    withoutCacheTask2Tokens = response2.usage?.completion_tokens || 0;  // 记录输出 token 数
    
    const totalEndTime = performance.now();
    withoutCacheTotalTime = (totalEndTime - totalStartTime) / 1000;
    
    taskOutputEl.textContent = `✅ WITHOUT Cache Results:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Task 1 (${withoutCacheTask1Time.toFixed(3)}s):
${task1Result.substring(0, 150)}${task1Result.length > 150 ? '...' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Task 2 (${withoutCacheTask2Time.toFixed(3)}s):
${task2Result.substring(0, 150)}${task2Result.length > 150 ? '...' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️  Timing Breakdown:
• Task 1: ${withoutCacheTask1Time.toFixed(3)}s (prefill: ${task1Prefill.toFixed(3)}s)
• Task 2: ${withoutCacheTask2Time.toFixed(3)}s (prefill: ${task2Prefill.toFixed(3)}s)
• Total: ${withoutCacheTotalTime.toFixed(3)}s

📊 Token Usage:
• Task 1: ${withoutCacheTask1Tokens} tokens
• Task 2: ${withoutCacheTask2Tokens} tokens
• Total: ${withoutCacheTask1Tokens + withoutCacheTask2Tokens} tokens`;
    
    setStatus("✅ Both tasks without cache completed!", "success");
    runWithCache.disabled = false;
    runWithoutCache.disabled = false;
    
    updatePerfComparison();
  } catch (error) {
    taskOutputEl.textContent = `❌ Error: ${error}`;
    setStatus(`❌ Error: ${error}`, "error");
    console.error(error);
    runWithCache.disabled = false;
    runWithoutCache.disabled = false;
  }
};

function updatePerfComparison() {
  if (withCacheTotalTime > 0 && withoutCacheTotalTime > 0) {
    // 计算总输出 token 数
    const withCacheTotalTokens = withCacheTask1Tokens + withCacheTask2Tokens;
    const withoutCacheTotalTokens = withoutCacheTask1Tokens + withoutCacheTask2Tokens;
    
    // 计算每 token 平均耗时（基于输出 token）
    const withCacheTimePerToken = withCacheTotalTime / withCacheTotalTokens;
    const withoutCacheTimePerToken = withoutCacheTotalTime / withoutCacheTotalTokens;
    const speedup = ((withoutCacheTimePerToken - withCacheTimePerToken) / withoutCacheTimePerToken * 100);
    
    perfOutputEl.textContent = `📊 Performance Comparison:

WITH Cache:    ${(withCacheTimePerToken * 1000).toFixed(2)} ms/token (${withCacheTotalTokens} tokens, ${withCacheTotalTime.toFixed(3)}s total)
WITHOUT Cache: ${(withoutCacheTimePerToken * 1000).toFixed(2)} ms/token (${withoutCacheTotalTokens} tokens, ${withoutCacheTotalTime.toFixed(3)}s total)

⚡ Speedup: ${speedup.toFixed(1)}% faster per output token`;
  } else if (withCacheTotalTime > 0) {
    const withCacheTotalTokens = withCacheTask1Tokens + withCacheTask2Tokens;
    const withCacheTimePerToken = withCacheTotalTime / withCacheTotalTokens;
    perfOutputEl.textContent = `📊 Partial Results:
WITH Cache: ${(withCacheTimePerToken * 1000).toFixed(2)} ms/token (${withCacheTotalTokens} tokens)

⚠️ Run "WITHOUT cache" to see the comparison!`;
  } else if (withoutCacheTotalTime > 0) {
    const withoutCacheTotalTokens = withoutCacheTask1Tokens + withoutCacheTask2Tokens;
    const withoutCacheTimePerToken = withoutCacheTotalTime / withoutCacheTotalTokens;
    perfOutputEl.textContent = `📊 Partial Results:
WITHOUT Cache: ${(withoutCacheTimePerToken * 1000).toFixed(2)} ms/token (${withoutCacheTotalTokens} tokens)

⚠️ Run "WITH cache" to see the speedup!`;
  }
}

// Initialize on load
initEngine();
