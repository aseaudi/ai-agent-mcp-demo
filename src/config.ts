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
  mcpServerCwd: string;
  atlassianMcpCommand: string;
  atlassianMcpArgs: string[];
  jiraUrl: string;
  jiraUsername: string;
  jiraApiToken: string;
  confluenceUrl: string;
  confluenceUsername: string;
  confluenceApiToken: string;
  targetBranch: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
}

function parseArgs(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  const atlassianMcpArgsRaw = optional(
    "ATLASSIAN_MCP_SERVER_ARGS",
    "mcp-atlassian"
  );
  const atlassianKeys = [
    "JIRA_URL",
    "JIRA_USERNAME",
    "JIRA_API_TOKEN",
    "CONFLUENCE_URL",
    "CONFLUENCE_USERNAME",
    "CONFLUENCE_API_TOKEN",
  ] as const;

  for (const key of atlassianKeys) {
    required(key);
  }

  return {
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    claudeModel: optional("CLAUDE_MODEL", "claude-sonnet-4-20250514"),

    bitbucketUsername: required("BITBUCKET_USERNAME"),
    bitbucketAppPassword: required("BITBUCKET_APP_PASSWORD"),
    bitbucketWorkspace: required("BITBUCKET_WORKSPACE"),
    bitbucketRepo: required("BITBUCKET_REPO"),
    bitbucketBaseUrl: optional("BITBUCKET_BASE_URL", ""),

    mcpServerCommand: optional("MCP_SERVER_COMMAND", "npx"),
    mcpServerArgs: parseArgs(mcpServerArgsRaw),
    mcpServerCwd: optional("MCP_SERVER_CWD", ""),

    atlassianMcpCommand: optional("ATLASSIAN_MCP_SERVER_COMMAND", "uvx"),
    atlassianMcpArgs: parseArgs(atlassianMcpArgsRaw),
    jiraUrl: required("JIRA_URL"),
    jiraUsername: required("JIRA_USERNAME"),
    jiraApiToken: required("JIRA_API_TOKEN"),
    confluenceUrl: required("CONFLUENCE_URL"),
    confluenceUsername: required("CONFLUENCE_USERNAME"),
    confluenceApiToken: required("CONFLUENCE_API_TOKEN"),

    targetBranch: optional("TARGET_BRANCH", "main"),
    gitAuthorName: optional("GIT_AUTHOR_NAME", "Bitbucket MCP Agent"),
    gitAuthorEmail: optional("GIT_AUTHOR_EMAIL", "agent@example.com"),
  };
}
