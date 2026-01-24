# Prefix Tree Multi-Topic Chat Demo

## Overview

This example demonstrates the **Prefix Tree** data structure in web-llm for managing multiple conversation topics efficiently.

## Features

- 🌳 **Topic Management**: Create, switch, and delete conversation topics using tree structure
- 📊 **Tree Visualization**: Real-time display of tree topology and node information
- ⚡ **Efficient Context Switching**: O(1) switching between topics with shared KV cache prefixes
- 💾 **Memory Optimization**: Shared KV cache prefix reduces memory consumption

## How It Works

### Tree Structure

Each topic is a node in the prefix tree:

```
         [root]
        /  |  \
   [AI] [Python] [WebDev]
```

- **Root Node**: Initial conversation context
- **Child Nodes**: Topic branches created from parent nodes
- **Shared Prefix**: Child nodes inherit parent's KV cache prefix via `ForkSequence`

### API Usage

```typescript
// Create a new topic branch
pipeline.createConversationBranch("AI");

// Switch to a topic
pipeline.switchToNode("AI");

// Delete a topic and its subtree
pipeline.deleteNode("AI");

// Get tree information
const stats = pipeline.getPrefixTreeStats();
const nodeInfo = pipeline.getPrefixTreeNodeInfo("AI");
```

## Key Benefits

1. **Memory Efficiency**: Topics sharing a prefix don't duplicate KV cache data
2. **Fast Context Switch**: O(1) operation to switch between topics
3. **Flexible Hierarchy**: Support arbitrary tree structures
4. **Real-time Monitoring**: See tree statistics and node details instantly

## Usage

1. **Create Topics**: Enter a topic name and click "Create Topic"
2. **Switch Topics**: Click on a topic button to switch context
3. **Chat**: Type messages in the current topic context
4. **Delete Topics**: Remove topics you no longer need

## Example Scenarios

### Scenario 1: Simple Multi-Topic Chat
- Create topics: "AI", "Python", "JavaScript"
- Switch between them freely
- Each topic maintains its own conversation history

### Scenario 2: Hierarchical Topics
- Create "Programming" topic
- Switch to "Programming"
- Create "Python" subtopic under "Programming"
- Navigate the hierarchy

### Scenario 3: Context Reuse
- Establish a system context in root
- Create multiple topics
- All topics inherit the root context efficiently

## Technical Details

### ForkSequence Optimization

When creating a branch topic, the system uses `ForkSequence` to share the parent's KV cache:

```
Parent KV: [===shared_prefix===|new_data_1]
           ↓ (ForkSequence)
Child KV:  [===shared_prefix===|new_data_2]  ← Same prefix, no copy!
```

Result: ~50% memory savings when topics share long prefixes

### Tree Information Display

The demo shows:
- **Total Nodes**: Number of topics in tree
- **Tree Depth**: Maximum depth of the tree
- **Node Details**: Filled length, message count, parent/children relationships

## Performance Notes

- Topic creation: O(1)
- Topic switching: O(1)
- Topic deletion: O(n) where n is subtree size
- Memory usage: Reduced by sharing KV cache prefixes

## Limitations (Current Phase)

- No automatic memory management (LRU)
- No persistence to CPU/disk
- No node merging capabilities

These will be added in future phases.
