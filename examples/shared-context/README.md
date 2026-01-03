# WebLLM Shared Context Demo

This example demonstrates WebLLM's shared context feature, which allows multiple requests to share a common KV cache prefix, avoiding redundant computation.

## Features

- **Save Shared Context**: Pre-compute and save KV cache for common context (e.g., system prompts)
- **Reuse Across Tasks**: Multiple tasks can reference the same shared context
- **Performance Optimization**: Significantly reduces prefill time for subsequent requests

## How It Works

1. **Save Phase**: Call `engine.saveSharedContext(contextId, messages)` to pre-compute and cache KV cache
2. **Use Phase**: Include `extra_body: { shared_context_id: contextId }` in your chat completion requests
3. **Benefit**: The engine loads the cached KV cache instead of recomputing from scratch

## Running the Demo

```bash
npm install
npm start
```

Then open http://localhost:8000 in your browser.

## Usage Example

```typescript
// 1. Save shared context
await engine.saveSharedContext("ctx-1", [
  {
    role: "system",
    content: "You are a helpful AI assistant specialized in math and programming.",
  },
]);

// 2. Use shared context in multiple requests
const response1 = await engine.chat.completions.create({
  messages: [{ role: "user", content: "What is a prime number?" }],
  extra_body: { shared_context_id: "ctx-1" },
});

const response2 = await engine.chat.completions.create({
  messages: [{ role: "user", content: "Write a quicksort function" }],
  extra_body: { shared_context_id: "ctx-1" },
});
```

## Use Cases

- **Chatbot with Fixed System Prompt**: Save the system prompt once, reuse for all user queries
- **Batch Processing**: Process multiple tasks with the same context efficiently
- **Multi-User Scenarios**: Share common context across different user sessions
