import * as webllm from "@mlc-ai/web-llm";

function setLabel(id: string, text: string) {
  const label = document.getElementById(id);
  if (label == null) {
    throw Error("Cannot find label " + id);
  }
  label.innerText = text;
}

let engine: webllm.MLCEngineInterface;
// 存储对话历史
let conversationHistory: webllm.ChatCompletionMessageParam[] = [];

async function initializeEngine() {
  const initProgressCallback = (report: webllm.InitProgressReport) => {
    setLabel("init-label", report.text);
  };
  
  // Option 1: If we do not specify appConfig, we use `prebuiltAppConfig` defined in `config.ts`
  const selectedModel = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
  engine = await webllm.CreateMLCEngine(
    selectedModel,
    {
      initProgressCallback: initProgressCallback,
      logLevel: "INFO", // specify the log level
    },
    // customize kv cache, use either context_window_size or sliding_window_size (with attention sink)
    {
      context_window_size: 2048,
      // sliding_window_size: 1024,
      // attention_sink_size: 4,
    },
  );

  // Option 2: Specify your own model other than the prebuilt ones
  // const appConfig: webllm.AppConfig = {
  //   model_list: [
  //     {
  //       model: "https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f32_1-MLC",
  //       model_id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
  //       model_lib:
  //         webllm.modelLibURLPrefix +
  //         webllm.modelVersion +
  //         "/Llama-3_1-8B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm",
  //       overrides: {
  //         context_window_size: 2048,
  //       },
  //     },
  //   ],
  // };
  // const engine: webllm.MLCEngineInterface = await webllm.CreateMLCEngine(
  //   selectedModel,
  //   { appConfig: appConfig, initProgressCallback: initProgressCallback },
  // );

  // Option 3: Instantiate MLCEngine() and call reload() separately
  // const engine: webllm.MLCEngineInterface = new webllm.MLCEngine({
  //   appConfig: appConfig, // if do not specify, we use webllm.prebuiltAppConfig
  //   initProgressCallback: initProgressCallback,
  // });
  // await engine.reload(selectedModel);

  console.log("=== Model Loaded ===");
  setLabel("init-label", "Model ready");

  // Enable generate button
  const generateBtn = document.getElementById("generate-btn") as HTMLButtonElement;
  if (generateBtn) {
    generateBtn.disabled = false;
  }
}

async function generateResponse() {
  const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
  const generateBtn = document.getElementById("generate-btn") as HTMLButtonElement;
  
  if (!promptInput || !generateBtn) {
    return;
  }

  const promptText = promptInput.value.trim();
  if (!promptText) {
    alert("Please input a prompt");
    return;
  }

  // 禁用按钮，防止重复点击
  generateBtn.disabled = true;
  setLabel("init-label", "Generating...");
  setLabel("generate-label", "Generating...");
  setLabel("stats-label", "");

  console.log("Prompt:", promptText);

  try {
    // 添加用户消息到历史
    conversationHistory.push({ role: "user", content: promptText });

    const reply = await engine.chat.completions.create({
      messages: conversationHistory, // 使用完整对话历史
      temperature: 1.0,
      max_tokens: 256,
    });
    
    const assistantMessage = reply.choices[0].message.content || "";
    
    // 添加助手回复到历史
    conversationHistory.push({ role: "assistant", content: assistantMessage });
    
    console.log("Reply:", assistantMessage);
    console.log("=== Token's Statistics ===");
    console.log(reply.usage);
    
    // 显示完整对话历史
    let fullConversation = "";
    conversationHistory.forEach((msg, index) => {
      const roleLabel = msg.role === "user" ? "user" : "assistant";
      fullConversation += `${roleLabel}:\n${msg.content}\n\n`;
    });
    
    setLabel("generate-label", fullConversation);
    
    // 显示统计信息
    const statsText = `Conversation rounds: ${Math.floor(conversationHistory.length / 2)} | Prompt tokens: ${reply.usage?.prompt_tokens || 0} | Completion tokens: ${reply.usage?.completion_tokens || 0} | Total tokens: ${reply.usage?.total_tokens || 0}`;
    setLabel("stats-label", statsText);
    setLabel("init-label", "Model ready");
    
    // 清空输入框，准备下一轮
    promptInput.value = "";
    
  } catch (error) {
    console.error("=== Error ===");
    console.error(error);
    setLabel("init-label", "Generation error: " + error.message);
    setLabel("generate-label", "Generation failed");
  } finally {
    // 重新启用按钮
    generateBtn.disabled = false;
  }
}

// 重置对话历史
function resetConversation() {
  conversationHistory = [];
  setLabel("generate-label", "对话已重置");
  setLabel("stats-label", "");
  console.log("=== 对话历史已清空 ===");
}

async function main() {
  // 初始化模型
  await initializeEngine();
  
  // 绑定生成按钮事件
  const generateBtn = document.getElementById("generate-btn");
  if (generateBtn) {
    generateBtn.onclick = generateResponse;
  }
  
  // 添加重置按钮（如果 HTML 中有的话）
  const resetBtn = document.getElementById("reset-btn");
  if (resetBtn) {
    resetBtn.onclick = resetConversation;
  }
}

main();
