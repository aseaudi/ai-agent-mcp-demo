/**
 * agent.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool as AnthropicTool,
  ToolUseBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { BitbucketMCPClient, type MCPToolDefinition } from "./mcp-client.js";
import { logger } from "./logger.js";

const MAX_ITERATIONS = 30;

export interface AgentConfig {
  anthropicApiKey: string;
  model: string;
  workspace: string;
  repo: string;
  targetBranch?: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
}

export interface AgentResult {
  summary: string;
  filesModified: string[];
  commitSha?: string;
  iterationCount: number;
}

// ---------------------------------------------------------------------------
// Parameter aliases: maps wrong names Claude tends to invent → correct names
// for @nexus2520/bitbucket-mcp-server
// ---------------------------------------------------------------------------
const PARAM_ALIASES: Record<string, string> = {
  // repo identifier
  workspace: "repo_slug",
  repository: "repo_slug",
  repo: "repo_slug",
  repo_name: "repo_slug",
  repository_slug: "repo_slug",

  // branch / ref
  branch: "ref",
  branch_name: "ref",
  commit: "ref",

  // file path
  filepath: "file_path",
  filename: "file_path",
  path: "file_path",
  file: "file_path",

  // directory path (list_directory_content uses "path" — keep as-is for that tool,
  // but map "directory" → "path")
  directory: "path",
  dir: "path",
  folder: "path",
};

// For list_directory_content the path param IS called "path", not "file_path"
const DIR_TOOLS = new Set(["list_directory_content", "list_directory", "list_files"]);

export class BitbucketAgent {
  private anthropic: Anthropic;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async run(userQuery: string, mcpClient: BitbucketMCPClient): Promise<AgentResult> {
    logger.info("Running Bitbucket agent...");
    const tools = mcpClient.tools;
    const anthropicTools = this.mcpToolsToAnthropicTools(tools);
    const systemPrompt = this.buildSystemPrompt(tools);

    const messages: MessageParam[] = [
      { role: "user", content: this.buildUserMessage(userQuery) },
    ];

    let iteration = 0;
    let finalText = "";
    const filesModified: string[] = [];
    let commitSha: string | undefined;

    logger.info(`Starting agent loop for query: "${userQuery}"`);

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      logger.info(`\n── Iteration ${iteration} ──────────────────────────`);
      // logger.info(`Sending System Prompt:\n${systemPrompt}`);
      // logger.info(`Sending tools: ${anthropicTools.map((t) => t.name + "\n" + t.description + "\n" + JSON.stringify(t.input_schema)).join("\n")}`);
      logger.info(`Sending messages to model: ${JSON.stringify(messages)}`);

      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: 8192,
        system: systemPrompt,
        tools: anthropicTools,
        messages,
      });

      logger.info(`Model response received: ${JSON.stringify(response)}`);

      logger.info(`Stop reason: ${response.stop_reason}`);

      const textBlocks = response.content.filter((b) => b.type === "text");
      if (textBlocks.length > 0) {
        const text = textBlocks.map((b) => (b as { type: "text"; text: string }).text).join("\n");
        logger.agent(text);
        finalText = text;
      }

      if (response.stop_reason === "end_turn") break;

      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      ) as ToolUseBlock[];

      if (toolUseBlocks.length === 0) break;

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        // Normalise args BEFORE logging so the log shows what we actually send
        // const rawArgs = toolUse.input as Record<string, unknown>;
        // const args = this.normalizeToolArgs(toolUse.name, rawArgs);
        const args = toolUse.input as Record<string, unknown>;
        logger.tool(toolUse.name, args);

        let resultText: string;
        let isError = false;

        try {
          resultText = await mcpClient.callToolText(toolUse.name, args);
          this.extractMetadata(args, filesModified);
          const sha = this.extractCommitSha(toolUse.name, resultText);
          if (sha) commitSha = sha;
          logger.toolResult(resultText.slice(0, 300));
        } catch (err) {
          resultText = `ERROR: ${(err as Error).message}`;
          isError = true;
          logger.error(`Tool ${toolUse.name} failed: ${resultText}`);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultText,
          is_error: isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (iteration >= MAX_ITERATIONS) logger.warn("Reached maximum iteration limit.");

    return {
      summary: finalText,
      filesModified: [...new Set(filesModified)],
      commitSha,
      iterationCount: iteration,
    };
  }

  // ── Normalise tool arguments ───────────────────────────────────────────────

  /**
   * Remap any parameter names Claude invented to the correct names expected by
   * @nexus2520/bitbucket-mcp-server, and inject missing required values.
   */
  private normalizeToolArgs(
    toolName: string,
    raw: Record<string, unknown>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const isDir = DIR_TOOLS.has(toolName);

    for (const [key, value] of Object.entries(raw)) {
      // Remap aliases, but for directory tools keep "path" as "path"
      let mapped = key;
      if (PARAM_ALIASES[key]) {
        const alias = PARAM_ALIASES[key];
        // Don't remap "path" → "file_path" for directory listing tools
        if (key === "path" && isDir) {
          mapped = "path";
        } else {
          mapped = alias;
        }
      }
      out[mapped] = value;
    }

    // Always inject repo_slug if missing
    if (!out["repo_slug"]) {
      out["repo_slug"] = this.config.repo;
    }

    // Always inject ref/branch if the tool likely needs it and it's missing
    const needsRef = ["get_file_content", "list_directory_content", "list_files",
                      "search_files", "find_in_files", "get_file_blame",
                      "list_branch_commits"].includes(toolName);
    if (needsRef && !out["ref"]) {
      out["ref"] = this.config.targetBranch || "main";
    }

    return out;
  }

  // ── System prompt ──────────────────────────────────────────────────────────

  private buildSystemPrompt(tools: MCPToolDefinition[]): string {
    type SchemaProp = { type?: string; description?: string; default?: unknown };
    const toolDocs = tools
      .map((t) => {
        const schema = t.inputSchema as {
          properties?: Record<string, SchemaProp>;
          required?: string[];
        };
        const props = schema?.properties ?? {};
        const required = new Set(schema?.required ?? []);
        const params = Object.entries(props)
          .map(([name, def]) => {
            const req = required.has(name) ? "REQUIRED" : `optional`;
            return `      - ${name} [${req}]: ${def.description ?? def.type ?? ""}`;
          })
          .join("\n");
        return `  ### ${t.name}\n  ${t.description}\n  Parameters:\n${params || "      (none)"}`;
      })
      .join("\n\n");

    const branch = this.config.targetBranch || "main";

    return `You are an expert software engineering agent with access to a Bitbucket repository via MCP tools.

## Your Mission
1. Explore the repository structure to understand the codebase
2. Identify all files that need to be created or modified
3. Read each relevant file's current content
4. Write back the updated file content
5. Commit all changes with a descriptive message

## Repository Context
- repo_slug: ${this.config.repo}
- ref (branch): ${branch}
- Commit author: ${this.config.gitAuthorName} <${this.config.gitAuthorEmail}>

## CRITICAL — Exact Parameter Names
You MUST use parameter names EXACTLY as shown in the Tool Reference below.
The correct parameter names for this server are:
- Use "repo_slug" (NOT workspace / repository / repo)
- Use "ref"      (NOT branch / branch_name)
- Use "file_path" for file operations (NOT path / filepath / filename)
- Use "path"     for directory listing (list_directory_content)

## Tool Reference
${toolDocs}

## Rules
- repo_slug is always "${this.config.repo}"
- ref is always "${branch}"
- Read a file before modifying it
- Update ALL affected files before committing
- Commit message should be imperative mood: "Add login screen"
- Summarise what you did after committing`;
  }

  private buildUserMessage(query: string): string {
    return `Please implement the following change in the repository:

> ${query}

Start by listing the root directory, then explore relevant subdirectories, read the files you need to modify, make the changes, and commit.`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private mcpToolsToAnthropicTools(mcpTools: MCPToolDefinition[]): AnthropicTool[] {
    return mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as AnthropicTool["input_schema"],
    }));
  }

  private extractMetadata(args: Record<string, unknown>, filesModified: string[]): void {
    for (const key of ["file_path", "filepath", "filename"]) {
      if (typeof args[key] === "string") filesModified.push(args[key] as string);
    }
  }

  private extractCommitSha(toolName: string, result: string): string | undefined {
    if (!toolName.toLowerCase().includes("commit")) return undefined;
    const match = result.match(/\b([0-9a-f]{7,40})\b/);
    return match?.[1];
  }
}
