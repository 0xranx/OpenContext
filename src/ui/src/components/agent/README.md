# Agent UI Components

This folder contains Agent-related UI components. The goal is to keep `AgentSidebar` smaller and improve readability and maintainability.

## Component Relationships

- `AgentSidebar.jsx`
  - Owns state and composes the UI
  - Uses:
    - `AgentMessageList`
    - `AgentInputBar`
    - `AgentSessionSetup`
    - `IntentSelector`

- `AgentMessageList.jsx`
  - Renders the message list
  - Internally uses `ToolCard` / `ToolList` / `MessageBubble` / `ThoughtMessage`
  - Depends on `constants.js` for tool status styles

- `AgentInputBar.jsx`
  - Renders the input area (intent selector, model selector, send button)

- `AgentSessionSetup.jsx`
  - Renders the new session setup UI

- `IntentSelector.jsx`
  - Handles intent dropdown selection

## Shared Config
- `constants.js`
  - `INTENT_CONFIG`: intent label/placeholder configuration
  - `TOOL_STATUS_STYLES`: tool card status styles
