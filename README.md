# Bitbucket MCP Agent

A Node.js TypeScript application that connects to one or more **MCP servers**, uses **Claude** as the AI brain, and can handle natural-language requests against your Bitbucket repository plus Atlassian tools, including creating and updating Jira tickets and Confluence pages.

---

## How It Works

```
User query: "add a login screen"
        │
        ▼
  Claude (claude-sonnet-4)
  ┌─────────────────────────────────────────────────────┐
  │  1. List repo files  → MCP: list_directory / search │
  │  2. Read relevant files → MCP: get_file_content     │
  │  3. Produce updated code                            │
  │  4. Write files back → MCP: create_or_update_file   │
  │  5. Commit changes   → MCP: commit_files            │
  └─────────────────────────────────────────────────────┘
        │
        ▼
  Commit pushed to Bitbucket ✓
```

Claude runs in an **agentic tool-calling loop**: it keeps calling MCP tools until it has fully implemented the change and committed everything. The loop is capped at 30 iterations to prevent runaway API usage.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18.0.0 |
| npm | ≥ 9 |
| Bitbucket account | any |
| Anthropic API key | any plan with Claude Sonnet access |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `BITBUCKET_USERNAME` | Your Bitbucket username |
| `BITBUCKET_APP_PASSWORD` | App password from [Bitbucket settings](https://bitbucket.org/account/settings/app-passwords/) |
| `BITBUCKET_WORKSPACE` | Workspace slug (e.g. `mycompany`) |
| `BITBUCKET_REPO` | Repository slug (e.g. `my-frontend-app`) |

To also enable Jira ticket and Confluence page create/update actions, fill in these optional variables:

| Variable | Description |
|---|---|
| `ATLASSIAN_MCP_SERVER_COMMAND` | Usually `uvx` |
| `ATLASSIAN_MCP_SERVER_ARGS` | Usually `mcp-atlassian` |
| `JIRA_URL` | Jira base URL, e.g. `https://your-company.atlassian.net` |
| `JIRA_USERNAME` | Jira account email |
| `JIRA_API_TOKEN` | Jira API token |
| `CONFLUENCE_URL` | Confluence base URL, e.g. `https://your-company.atlassian.net/wiki` |
| `CONFLUENCE_USERNAME` | Confluence account email |
| `CONFLUENCE_API_TOKEN` | Confluence API token |

The agent uses the [`bitbucket-mcp`](https://www.npmjs.com/package/bitbucket-mcp) package, which is auto-installed via `npx -y bitbucket-mcp@latest` — no separate install needed.

**Required Bitbucket app-password permissions:**
- Repositories: Read, Write
- Pull Requests: Read, Write (optional, for future PR creation)

### 3. Build

```bash
npm run build
```

### 4. Run

**Interactive mode** (pick from menu or type a custom query):
```bash
npm start
```

**Pass a query directly:**
```bash
npm start "add a login screen with username and password fields"
npm start "add dark mode support with a toggle button in the nav bar"
npm start "add a 404 not found page"
npm start "create confluence page for the engineering weekly update"
npm start "update confluence page 123456 with the latest release notes"
npm start "delete confluence page 123456"
npm start "create a jira ticket with issue type task title login page and description please add a login page"
npm start "update jira ticket PROJ-123 to set the description to include the latest QA notes"
npm start "create a confluence page in the SCRUM space titled Project Overview and add a high level overview about the project features, roadmap, and its software architecture"
```

**Debug mode** (verbose MCP + agent output):
```bash
DEBUG=1 npm start
```

---

## Example Session

```
╔══════════════════════════╗
║  Bitbucket MCP Agent     ║
╚══════════════════════════╝

[INFO]  Using model : claude-sonnet-4-20250514
[INFO]  Workspace   : mycompany
[INFO]  Repository  : my-react-app
[INFO]  Branch      : main

[INFO]  Connecting to Bitbucket MCP server…
[OK]    Connected to MCP server.

[INFO]  12 tools available from the MCP server:

  list_directory        List files in a directory
  get_file_content      Read the contents of a file
  create_or_update_file Create or overwrite a file
  search_code           Search for code patterns
  commit_files          Stage and commit changes
  ...

? What would you like to do?
❯ Add a login screen

── Iteration 1 ────────────────────────────────────
⚙  list_directory
    { "path": "/" }
✓  src/ public/ package.json README.md …

⚙  list_directory
    { "path": "src" }
✓  App.tsx components/ pages/ ...

⚙  get_file_content
    { "path": "src/App.tsx" }
✓  import React from 'react'...

⚙  create_or_update_file
    { "path": "src/pages/LoginPage.tsx", "content": "..." }
✓  File created successfully

⚙  commit_files
    { "message": "Add login screen component" }
✓  Committed: a3f9d12

╔══════════╗
║  Done    ║
╚══════════╝

[OK]  Commit SHA : a3f9d12
[OK]  Files touched:
        • src/pages/LoginPage.tsx
        • src/App.tsx
[INFO] Iterations : 4
```

---

## Project Structure

```
bitbucket-mcp-agent/
├── src/
│   ├── index.ts        # CLI entry point & interactive prompts
│   ├── agent.ts        # Agentic tool-calling loop (Claude ↔ MCP)
│   ├── mcp-client.ts   # MCP server connection & tool execution
│   ├── config.ts       # Environment variable loading & validation
│   └── logger.ts       # Coloured structured logger
├── .env.example        # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

---

## Configuration Reference

All configuration lives in `.env`. See `.env.example` for the full list.

### MCP Servers

The agent uses [`bitbucket-mcp`](https://www.npmjs.com/package/bitbucket-mcp) by default, auto-installed via npx:

```env
MCP_SERVER_COMMAND=npx
MCP_SERVER_ARGS=-y,bitbucket-mcp@latest
```

For **Bitbucket Server / Data Center**, also set:
```env
BITBUCKET_URL=https://bitbucket.mycompany.com/rest/api/1.0
```

To also connect an Atlassian MCP server for Jira ticket and Confluence page create/update support:

```env
ATLASSIAN_MCP_SERVER_COMMAND=uvx
ATLASSIAN_MCP_SERVER_ARGS=mcp-atlassian
JIRA_URL=https://your-company.atlassian.net
JIRA_USERNAME=your.email@company.com
JIRA_API_TOKEN=your_api_token
CONFLUENCE_URL=https://your-company.atlassian.net/wiki
CONFLUENCE_USERNAME=your.email@company.com
CONFLUENCE_API_TOKEN=your_api_token
```

When enabled, the agent exposes both Bitbucket and Atlassian tools to Claude in the same session. Tool names are prefixed with the MCP server alias to avoid collisions, for example `bitbucket__get_file_content` or `atlassian__create_confluence_page`.

### Model

```env
CLAUDE_MODEL=claude-sonnet-4-20250514
```

### Branch

Leave `TARGET_BRANCH` empty to use the repository's default branch, or set it to commit to a specific branch:

```env
TARGET_BRANCH=feature/ai-changes
```

---

## Extending the Agent

**Add more example queries** — edit the `choices` array in `src/index.ts`.

**Change agent behaviour** — edit `buildSystemPrompt()` in `src/agent.ts` to give Claude different instructions (e.g. always create a PR instead of committing directly).

**Use a different MCP server** — point `MCP_SERVER_COMMAND` / `MCP_SERVER_ARGS` at any stdio MCP server; the agent is server-agnostic.

**Add another MCP server** — configure the optional Atlassian variables in `.env`; the CLI will connect to both servers and merge their tool lists.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required environment variable` | Copy `.env.example` → `.env` and fill all values |
| `Failed to connect to MCP server` | Ensure `npx` works and the package can install (`npx -y @modelcontextprotocol/server-bitbucket`) |
| `401 Unauthorized` from Bitbucket | Check app password permissions and that username is correct |
| Agent loops without making progress | Run with `DEBUG=1` to see all tool calls; check the system prompt in `agent.ts` |

---

## License

MIT
