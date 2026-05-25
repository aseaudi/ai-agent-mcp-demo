/**
 * config.ts — loads and validates environment variables.
 */

import "dotenv/config";

export interface AppConfig {
  anthropicApiKey: string;
  claudeModel: string;
  bitbucketUsername: string;
  bitbucketAppPassword: string;
  bitbucketWorkspace: string;
  bitbucketRepo: string;
  bitbucketBaseUrl: string; // optional, for Bitbucket Server
  mcpServerCommand: string;
  mcpServerArgs: string[];
  targetBranch: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
}

function required(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `  → Copy .env.example to .env and fill in all required values.`
    );
  }
  return value.trim();
}

function optional(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

export function loadConfig(): AppConfig {
  const mcpServerArgsRaw = optional(
    "MCP_SERVER_ARGS",
    "-y,@nexus2520/bitbucket-mcp-server"
  );

  return {
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    claudeModel: optional("CLAUDE_MODEL", "claude-sonnet-4-20250514"),

    bitbucketUsername: required("BITBUCKET_USERNAME"),
    bitbucketAppPassword: required("BITBUCKET_APP_PASSWORD"),
    bitbucketWorkspace: required("BITBUCKET_WORKSPACE"),
    bitbucketRepo: required("BITBUCKET_REPO"),
    bitbucketBaseUrl: optional("BITBUCKET_BASE_URL", ""),

    mcpServerCommand: optional("MCP_SERVER_COMMAND", "npx"),
    mcpServerArgs: mcpServerArgsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),

    targetBranch: optional("TARGET_BRANCH", "main"),
    gitAuthorName: optional("GIT_AUTHOR_NAME", "Bitbucket MCP Agent"),
    gitAuthorEmail: optional("GIT_AUTHOR_EMAIL", "agent@example.com"),
  };
}
