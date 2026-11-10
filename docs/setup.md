# ShadowForge — Setup Guide

## Windows Setup (Beginner-Friendly)

### Step 1: Install Prerequisites

1. **Node.js** (v18 or higher): https://nodejs.org/
   - After installing, open PowerShell and verify: `node --version`
   - Should show `v18.x.x` or higher

2. **Git**: https://git-scm.com/download/win

3. **VS Code**: https://code.visualstudio.com/

### Step 2: Start TrueForge Locally

Open PowerShell and run:

```powershell
npx @truefoundry/trueforge@latest
```

Wait for it to say "TrueForge is running". Then open http://localhost:3000 in your browser.

You should see the TrueForge dashboard.

### Step 3: Configure Your AI Model in TrueForge

1. Click **Settings** in TrueForge
2. Add your model provider (Anthropic, OpenAI, Google, etc.)
3. Enter your API key

### Step 4: Import the ShadowForge Agents

1. In TrueForge, go to **Agents**
2. Click **Import from YAML**
3. Import `shadowforge/agents/coder.yaml`
4. Import `shadowforge/agents/fallback/agent.yaml`
5. Update the model names to match what you have available

### Step 5: Install ShadowForge Extension

Open PowerShell in the `shadowforge` folder:

```powershell
cd "C:\Users\ROHIT TARKE\OneDrive\Desktop\TrueForge\shadowforge"
npm install
npm run compile
```

#### Option A: Development mode (recommended for testing)

1. Open the `shadowforge` folder in VS Code
2. Press `F5`
3. A new VS Code window opens with ShadowForge installed

#### Option B: Install as VSIX

```powershell
npm install -g @vscode/vsce
vsce package
code --install-extension shadowforge-0.1.0.vsix
```

### Step 6: Configure VS Code Settings

Press `Ctrl+,` in VS Code to open Settings. Search for "shadowforge":

- **TrueForge URL**: `http://localhost:8790` (default, leave as-is)
- **Primary Agent ID**: The name of your coder agent (e.g. `shadowforge-coder`)
- **Fallback Agent ID**: The name of your fallback agent (e.g. `shadowforge-fallback`)

### Step 7: Clone Flask for Evaluation

```powershell
cd "C:\Users\ROHIT TARKE\OneDrive\Desktop"
git clone https://github.com/pallets/flask flask-eval
cd flask-eval
git checkout 22d924701a6ae2e4cd01e9a15bbaf3946094af65
```

Then open the `flask-eval` folder in VS Code (the Extension Development Host).

---

## Common Issues

### "Failed to load @truefoundry/trueforge-sdk"

Run `npm install` in the `shadowforge` folder.

### "MCP server failed to start on port 3001"

Another process is using port 3001. Change `shadowforge.mcpPort` in settings to `3002`.

### "TrueForge agent not found"

Make sure you imported the agent YAML in TrueForge and the name matches the VS Code setting.

### Extension doesn't activate

- Check VS Code version is 1.90+
- Check the Developer Console: `Help → Toggle Developer Tools → Console`
- Look for `[ShadowForge]` log lines

---

## How to Debug

1. Open the Extension Development Host (`F5`)
2. Press `Ctrl+Shift+I` to open DevTools
3. Look at the Console tab for `[ShadowForge]` messages
4. Check the VS Code Output panel → Select "ShadowForge" from dropdown

---

## Understanding the UI

### Chat Panel (Activity Bar → ⬛ icon)

- Type your task here
- Use `@filename` to explicitly reference a file
- Status bar shows "Agent running..." during execution
- Click ✕ Cancel to stop immediately

### Context Ledger (also in Activity Bar)

- Shows which files were retrieved for your query
- Shows WHY each file was selected
- Shows token cost per file

### Model Health (also in Activity Bar)

- Green: Primary agent working
- Yellow: Using fallback agent
- Red: Both agents unavailable

### Inline Edit (Ctrl+K)

1. Click in a function you want to edit
2. Press `Ctrl+K`
3. Type your instruction in the input box
4. Press Enter
5. Review the diff in the diff editor
6. Click "Accept All" or "Reject All" in the chat panel

