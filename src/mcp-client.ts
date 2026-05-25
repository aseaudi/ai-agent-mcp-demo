/**
 * mcp-client.ts
 *
 * Thin wrapper around @modelcontextprotocol/sdk that:
 *  - Spawns the Bitbucket MCP server process via stdio transport
 *  - Lists all available tools
 *  - Calls individual tools and returns their results
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  Tool,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class BitbucketMCPClient {
  private client: Client;
  private transport: StdioClientTransport;
  private connected = false;
  private _tools: MCPToolDefinition[] = [];

  constructor(
    serverCommand: string,
    serverArgs: string[],
    env: Record<string, string>
  ) {
    this.transport = new StdioClientTransport({
      command: serverCommand,
      args: serverArgs,
      env: {
        ...process.env as Record<string, string>,
        ...env,
      },
    });

    this.client = new Client(
      { name: "bitbucket-mcp-agent", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  /** Connect to the MCP server and fetch the tool list */
  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this.connected = true;
    await this.refreshTools();
  }

  /** Disconnect cleanly */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  /** Refresh the cached tool list from the server */
  async refreshTools(): Promise<MCPToolDefinition[]> {
    this.assertConnected();
    const response = await this.client.listTools();

    this._tools = response.tools.map((t: Tool) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }));

    return this._tools;
  }

  /** Return the cached tool list (call connect() first) */
  get tools(): MCPToolDefinition[] {
    return this._tools;
  }

  /**
   * Invoke a tool by name with the given arguments.
   * Returns the raw CallToolResult so callers can inspect content blocks.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    this.assertConnected();
    const result = await this.client.callTool({ name, arguments: args });
    return result as CallToolResult;
  }

  /**
   * Convenience helper: call a tool and extract all text blocks as a
   * single joined string.
   */
  async callToolText(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const result = await this.callTool(name, args);
    return result.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("MCP client is not connected. Call connect() first.");
    }
  }
}
