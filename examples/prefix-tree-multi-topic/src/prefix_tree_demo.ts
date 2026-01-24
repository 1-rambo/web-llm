import * as webllm from "@mlc-ai/web-llm";

// Engine instance
let engine: webllm.MLCEngine;

// Track conversation nodes: nodeId -> {question, answer, children}
interface ConversationNode {
  nodeId: string;
  parentId?: string;
  question?: string;
  answer?: string;
  childrenIds: string[];
  createdAt: number;
}

let conversationTree = new Map<string, ConversationNode>();
let currentNodeId = "root";

// DOM elements
const statusEl = document.getElementById("status")!;
const systemPromptEl = document.getElementById("systemPrompt") as HTMLTextAreaElement;
const userInputEl = document.getElementById("userInput") as HTMLInputElement;
const sendMessageBtn = document.querySelector('button[onclick="sendMessage()"]') as HTMLButtonElement;
const clearChatBtn = document.querySelector('button[onclick="clearChat()"]') as HTMLButtonElement;
const responseEl = document.getElementById("response")!;
const prefillTimeEl = document.getElementById("prefillTime")!;
const treeStatsEl = document.getElementById("treeStats")!;
const conversationHistoryEl = document.getElementById("conversationHistory")!;
const treeVisualizationEl = document.getElementById("treeVisualization")!;

/**
 * Initialize WebLLM engine
 */
export async function initPipeline(): Promise<void> {
  const selectedModel = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

  showStatus("Initializing model...", "info");

  try {
    engine = await webllm.CreateMLCEngine(selectedModel, {
      logLevel: "INFO",
      initProgressCallback: (progress) => {
        showStatus(`Loading: ${progress.text} (${Math.round(progress.progress * 100)}%)`, "info");
      },
    });
    
    showStatus("✅ Model loaded successfully", "success");
    
    // Initialize conversation tree with root node
    conversationTree.set("root", {
      nodeId: "root",
      childrenIds: [],
      createdAt: Date.now(),
    });
    
    updateUI();
  } catch (e) {
    showStatus(`❌ Failed to load model: ${e}`, "error");
    console.error(e);
  }
}

/**
 * Send a message and create a new conversation node
 * ✅ 发送完整的对话历史，relying on filledKVCacheLength to handle prefix optimization
 */
export async function sendMessage(): Promise<void> {
  if (!engine) {
    alert("Engine not initialized");
    return;
  }

  const userMessage = userInputEl.value.trim();
  const systemPrompt = systemPromptEl.value.trim();

  if (!userMessage) {
    alert("Please enter a message");
    return;
  }

  showStatus("Processing...", "info");
  responseEl.textContent = "Generating response...";

  try {
    const startTime = performance.now();
    
    // Create a new node for this conversation turn
    const newNodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Add as child to current node
    const currentNode = conversationTree.get(currentNodeId);
    if (currentNode) {
      currentNode.childrenIds.push(newNodeId);
    }
    
    // Create new node in tree
    const newNode: ConversationNode = {
      nodeId: newNodeId,
      parentId: currentNodeId,
      question: userMessage,
      childrenIds: [],
      createdAt: Date.now(),
    };
    conversationTree.set(newNodeId, newNode);
    
    // Branch the conversation at this point
    // 创建新分支（新节点 filledLength = 父节点 filledLength）
    engine.createConversationBranch(newNodeId);
    // 切换到新节点（这会恢复父节点的 filledLength）
    engine.switchToNode(newNodeId);
    currentNodeId = newNodeId;
    
    // ✅ 系统层会自动处理：
    // - 识别这是前缀树的分支（filledLength > 0）
    // - 保留 filledLength，使用 KVCache 前缀
    // - getPromptArrayLastRound() 只处理新增消息
    
    let messages: any[] = [];
    
    // 只在根节点时添加 system prompt
    if (currentNodeId === "root" && systemPrompt) {
      messages.push({ role: "system" as const, content: systemPrompt });
    }
    
    // 从根节点到当前节点，收集所有问答对
    const pathMessages: any[] = [];
    let tempNodeId: string | undefined = currentNodeId;
    while (tempNodeId && tempNodeId !== "root") {
      const node = conversationTree.get(tempNodeId);
      if (!node) break;
      
      // 添加这个节点的Q&A（倒序，稍后反转）
      if (node.question) {
        pathMessages.unshift({ role: "user" as const, content: node.question });
        if (node.answer) {
          pathMessages.unshift({ role: "assistant" as const, content: node.answer });
        }
      }
      
      tempNodeId = node.parentId;
    }
    
    // 添加历史消息
    messages.push(...pathMessages);
    
    console.log(`[DEBUG] Sending ${messages.length} messages, system will handle KVCache prefix optimization`);
    
    const response = await engine.chat.completions.create({
      messages: messages,
    });

    const assistantMessage = response.choices[0].message.content || "";
    const endTime = performance.now();
    
    // Store answer in node
    newNode.answer = assistantMessage;
    
    // ✅ Memory is auto-updated by engine after generation
    // No need to manually update here
    console.log("[DEBUG] Generation completed, engine auto-updated memory");
    
    // Update UI
    responseEl.textContent = assistantMessage;
    prefillTimeEl.textContent = `${(endTime - startTime).toFixed(2)}ms`;
    userInputEl.value = "";
    showStatus("✅ Response generated", "success");
    
    updateUI();
  } catch (e) {
    showStatus(`❌ Error: ${e}`, "error");
    console.error(e);
  }
}

/**
 * Clear current conversation and reset to root
 */
export function clearChat(): void {
  if (!engine) return;

  try {
    engine.resetChat();
    engine.switchToNode("root");
    currentNodeId = "root";
    responseEl.textContent = "";
    userInputEl.value = "";
    showStatus("✅ Chat cleared", "success");
    updateUI();
  } catch (e) {
    showStatus(`❌ Error: ${e}`, "error");
    console.error(e);
  }
}

/**
 * Switch to a specific conversation node in the tree
 */
export function switchToConversationNode(nodeId: string): void {
  if (!engine) {
    alert("Engine not initialized");
    return;
  }

  // 检查节点是否存在于引擎中
  const engineStats = engine.getPrefixTreeStats?.();
  if (engineStats && !engineStats.nodeIds.includes(nodeId)) {
    alert(`Node "${nodeId}" no longer exists (was pruned by auto-pruning)`);
    return;
  }

  if (!conversationTree.has(nodeId)) {
    alert("Invalid node");
    return;
  }

  try {
    const switchSuccess = engine.switchToNode(nodeId);
    
    if (!switchSuccess) {
      // 缓存无效，提示用户需要重新生成
      const node = conversationTree.get(nodeId);
      alert(`This turn's cache was pruned. The conversation history is still preserved, but you need to regenerate from the nearest turn with valid cache.`);
      
      // 找到最近的有效缓存祖先并切换到它
      let parentId = node?.parentId;
      while (parentId && parentId !== "root") {
        const parentNode = conversationTree.get(parentId);
        if (parentNode && engine.switchToNode(parentId)) {
          currentNodeId = parentId;
          showStatus(`✅ Switched to turn ${parentId} (nearest valid cache). History is preserved, regenerate to restore "${nodeId}".`, "info");
          updateUI();
          return;
        }
        parentId = parentNode?.parentId;
      }
      
      // 如果没找到，切回根节点
      engine.switchToNode("root");
      currentNodeId = "root";
      showStatus(`Switched to root. History preserved but cache invalid for target turn.`, "info");
      updateUI();
      return;
    }
    
    currentNodeId = nodeId;
    
    const node = conversationTree.get(nodeId);
    responseEl.textContent = node?.answer ? `Previous answer: ${node.answer}` : "No response yet";
    
    showStatus(`✅ Switched to turn`, "success");
    updateUI();
  } catch (e) {
    showStatus(`❌ Error: ${e}`, "error");
    console.error(e);
  }
}

/**
 * Update all UI elements
 */
function updateUI(): void {
  syncTreeWithEngine();
  updateConversationHistory();
  updateTreeVisualization();
  updateTreeStats();
}

/**
 * 同步应用层的树与引擎层的树 - 删除已被剪枝的节点
 */
function syncTreeWithEngine(): void {
  if (!engine) return;

  const engineStats = engine.getPrefixTreeStats?.();
  if (!engineStats) return;

  const engineNodeIds = new Set(engineStats.nodeIds);
  const appNodeIds = Array.from(conversationTree.keys());

  // 第一步：找出在应用层存在但已被引擎删除的节点
  const deletedNodeIds: string[] = [];
  for (const nodeId of appNodeIds) {
    if (!engineNodeIds.has(nodeId)) {
      deletedNodeIds.push(nodeId);
      conversationTree.delete(nodeId);
      
      // 如果当前节点被删除，切回根节点
      if (currentNodeId === nodeId) {
        currentNodeId = "root";
      }
    }
  }

  // 第二步：从所有存在的节点的 childrenIds 中移除已删除的节点
  for (const nodeId of conversationTree.keys()) {
    const node = conversationTree.get(nodeId);
    if (!node) continue;
    
    // 过滤出仍然存在的子节点
    const validChildren = node.childrenIds.filter(childId => conversationTree.has(childId));
    node.childrenIds = validChildren;
  }

  // 第三步：清理孤立节点（父节点不存在的节点）
  const orphanNodeIds: string[] = [];
  for (const nodeId of conversationTree.keys()) {
    if (nodeId === "root") continue; // 根节点没有父节点，跳过
    
    const node = conversationTree.get(nodeId);
    if (node && node.parentId && !conversationTree.has(node.parentId)) {
      orphanNodeIds.push(nodeId);
    }
  }

  // 删除孤立节点
  for (const nodeId of orphanNodeIds) {
    conversationTree.delete(nodeId);
    if (currentNodeId === nodeId) {
      currentNodeId = "root";
    }
  }

  if (deletedNodeIds.length > 0) {
    console.log(`[syncTreeWithEngine] Removed ${deletedNodeIds.length} pruned nodes:`, deletedNodeIds);
  }
}

/**
 * Display conversation history
 */
function updateConversationHistory(): void {
  const history = [];
  
  // Traverse from root to current node to show the conversation path
  let node: ConversationNode | undefined = conversationTree.get(currentNodeId);
  const path: ConversationNode[] = [];
  
  while (node && node.nodeId !== "root") {
    path.unshift(node);
    node = node.parentId ? conversationTree.get(node.parentId) : undefined;
  }
  
  let html = '<div class="conversation-path">';
  
  for (let i = 0; i < path.length; i++) {
    const n = path[i];
    const isCurrentNode = n.nodeId === currentNodeId;
    const className = isCurrentNode ? "current-node" : "";
    
    html += `<div class="conversation-turn ${className}">`;
    html += `<div class="turn-number">Turn ${i + 1}</div>`;
    
    if (n.question) {
      html += `<div class="question"><strong>Q:</strong> ${escapeHtml(n.question)}</div>`;
    }
    
    if (n.answer) {
      html += `<div class="answer"><strong>A:</strong> ${escapeHtml(n.answer.substring(0, 200))}${n.answer.length > 200 ? "..." : ""}</div>`;
    }
    
    // 只计算存在的子节点
    const existingChildren = n.childrenIds.filter(id => conversationTree.has(id));
    if (existingChildren.length > 0) {
      html += `<div class="children-info">${existingChildren.length} alternative branch(es)</div>`;
    }
    
    if (!isCurrentNode) {
      html += `<button onclick="switchToConversationNode('${n.nodeId}')" class="switch-btn">Go to this turn</button>`;
    }
    
    html += `</div>`;
  }
  
  html += '</div>';
  conversationHistoryEl.innerHTML = html;
}

/**
 * Visualize the conversation tree
 */
function updateTreeVisualization(): void {
  let html = '<div class="tree-view">';
  html += '<div class="tree-title">🌳 Complete Conversation Tree</div>';
  
  // 递归构建树形结构
  function buildTreeHtml(nodeId: string, prefix: string = ""): string {
    const node = conversationTree.get(nodeId);
    if (!node) return "";
    
    const isCurrentNode = nodeId === currentNodeId;
    let result = "";
    
    // 根节点
    if (nodeId === "root") {
      result += '<div class="tree-node" style="padding-left: 0;">';
      result += '<span class="node-label current">🌱 Root</span>';
      result += '</div>';
      
      // 递归添加所有存在的子节点（过滤掉已被删除的）
      for (const childId of node.childrenIds) {
        if (conversationTree.has(childId)) {
          result += buildTreeHtml(childId, "");
        }
      }
    } else {
      // 非根节点
      result += '<div class="tree-node">';
      const questionPreview = node.question ? node.question.substring(0, 40) : "?";
      const buttonClass = isCurrentNode ? "tree-node-btn current" : "tree-node-btn";
      result += `<button class="${buttonClass}" onclick="switchToConversationNode('${nodeId}')" title="${node.question || ''}">${questionPreview}${(node.question?.length ?? 0) > 40 ? "..." : ""}</button>`;
      
      // 只计算存在的子节点
      const existingChildren = node.childrenIds.filter(id => conversationTree.has(id));
      if (existingChildren.length > 0) {
        result += ` <span style="color: #999; font-size: 11px;">(+${existingChildren.length})</span>`;
      }
      
      result += '</div>';
      
      // 递归添加存在的子节点
      for (const childId of existingChildren) {
        result += buildTreeHtml(childId, prefix + "  ");
      }
    }
    
    return result;
  }
  
  html += buildTreeHtml("root");
  html += '</div>';
  treeVisualizationEl.innerHTML = html;
}

/**
 * Helper: get depth of a node
 */
function getDepth(nodeId: string): number {
  const node = conversationTree.get(nodeId);
  if (!node || !node.parentId || node.parentId === "root") return 1;
  return 1 + getDepth(node.parentId);
}

/**
 * Update tree statistics
 */
function updateTreeStats(): void {
  const stats = engine?.getPrefixTreeStats();
  const memoryStats = (engine as any)?.getPrefixTreeMemoryStats?.();
  
  const currentNode = conversationTree.get(currentNodeId);
  const depth = currentNodeId === "root" ? 0 : getDepth(currentNodeId);
  
  // 计算树的最大深度
  let maxDepth = 0;
  for (const node of conversationTree.values()) {
    if (node.nodeId !== "root") {
      const nodeDepth = getDepth(node.nodeId);
      maxDepth = Math.max(maxDepth, nodeDepth);
    }
  }
  
  // 计算分支节点数（有多个子节点的节点）
  let branchingNodes = 0;
  for (const node of conversationTree.values()) {
    if (node.childrenIds.length > 1) {
      branchingNodes++;
    }
  }
  
  let html = `<div class="tree-stats">`;
  html += `<p><strong>📍 Current Node:</strong> ${currentNodeId === "root" ? "🌱 Root" : currentNodeId.substring(0, 16)}</p>`;
  html += `<p><strong>📊 Tree Depth:</strong> ${maxDepth}</p>`;
  html += `<p><strong>🔀 Total Turns:</strong> ${conversationTree.size}</p>`;
  html += `<p><strong>🌿 Branching Points:</strong> ${branchingNodes}</p>`;
  
  if (stats) {
    html += `<p><strong>⚙️ Engine Seq IDs:</strong> ${stats.nodeIds.length}</p>`;
  }
  
  if (memoryStats) {
    const totalBytes = memoryStats.totalMemoryBytes;
    let memoryDisplay = "";
    
    // Format memory display: show KB if < 1MB, otherwise show MB
    if (totalBytes < 1024 * 1024) {
      const totalKB = (totalBytes / 1024).toFixed(2);
      memoryDisplay = `${totalKB} KB`;
    } else {
      const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
      memoryDisplay = `${totalMB} MB`;
    }
    
    html += `<p><strong>💾 Total Memory:</strong> ${memoryDisplay}</p>`;
  }
  
  html += `</div>`;
  treeStatsEl.innerHTML = html;
}

/**
 * Show status message
 */
function showStatus(message: string, type: "info" | "success" | "error"): void {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Initialize on page load
 */
window.addEventListener("load", () => {
  initPipeline();
});

// Make functions globally accessible
(window as any).sendMessage = sendMessage;
(window as any).clearChat = clearChat;
(window as any).switchToConversationNode = switchToConversationNode;
(window as any).initPipeline = initPipeline;
