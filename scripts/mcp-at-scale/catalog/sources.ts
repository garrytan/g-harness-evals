// The catalog's source list: every public MCP server the survey looked at, the ones kept with how each is captured,
// and the ones left out with the reason. capture.ts and static.ts read SOURCES; build-ladder.ts reads SOURCES and
// SURVEY_EXCLUDED to write the survey into ladder.json.

import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_WORK = join(homedir(), '.cache/harness-evals/mcp-catalog');

export const REGISTRY_ALLOWLIST = [
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'proxy.golang.org',
  'sum.golang.org',
  'storage.googleapis.com',
  'index.crates.io',
  'static.crates.io',
  'repo.yarnpkg.com',
];

type Base = {
  server: string;
  repo: string;
  commit: string;
  subdir?: string;
  spdx: string;
  licenceFile: string;
  noticeFile?: string;
  job: string;
  excludeTools?: { name: string; reason: string }[];
};

export type RuntimeSource = Base & {
  method: 'runtime';
  image: string;
  install: string;
  workdir?: string;
  run: string[];
  buildGroup?: string;
  staticVia?: string;
  fullArgs?: string[];
  fullEnv?: Record<string, string>;
  runEnv?: Record<string, string>;
  coreFilter?: { switch: string; args?: string[]; env?: Record<string, string> };
};

export type Source = RuntimeSource;

const NODE = 'node:22-bookworm-slim';
const GO = 'golang:1-bookworm';
const UV = 'ghcr.io/astral-sh/uv:python3.12-bookworm-slim';
const RUST = 'rust:1-bookworm';
const UV_ENV = 'export UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_PYTHON=python3.12';
const PNPM = (v: string) => `npm install -g pnpm@${v}`;
const P = 'placeholder-not-a-credential';

const MCP_SERVERS = { repo: 'modelcontextprotocol/servers', commit: 'c799c8552b0f27b7a33a7b9233773da144dddcf5', spdx: 'Apache-2.0 AND MIT', licenceFile: 'LICENSE' };
const ARCHIVED = {
  repo: 'modelcontextprotocol/servers-archived', commit: '9be4674d1ddf8c469e6461a27a337eeb65f76c2e', spdx: 'MIT', licenceFile: 'LICENSE',
  method: 'runtime' as const, image: NODE, buildGroup: 'archived-node',
  install: 'npm ci\nfor w in gitlab slack postgres redis google-maps everart aws-kb-retrieval-server gdrive; do npm run build -w src/$w; done',
};
const AWSLABS = {
  repo: 'awslabs/mcp', commit: '07dd13a50f191297b4ad875e016de20d2266d521', spdx: 'Apache-2.0', licenceFile: 'LICENSE', noticeFile: 'NOTICE',
  method: 'runtime' as const, image: UV, buildGroup: 'awslabs',
  install: `${UV_ENV}\nmkdir -p /root/.aws && printf '[default]\\nregion = us-east-1\\n' > /root/.aws/config\nfor d in cloudwatch-mcp-server cloudtrail-mcp-server dynamodb-mcp-server iam-mcp-server amazon-sns-sqs-mcp-server aws-pricing-mcp-server s3-tables-mcp-server; do (cd src/$d && uv sync --frozen --no-dev); done`,
  runEnv: { AWS_REGION: 'us-east-1', HOME: '/root', FASTMCP_LOG_LEVEL: 'ERROR' },
};

const SLACK_SHIM = `package main

import (
	"os"
	"strings"

	"github.com/korotovsky/slack-mcp-server/pkg/provider"
	"github.com/korotovsky/slack-mcp-server/pkg/server"
	"go.uber.org/zap"
)

func main() {
	var enabled []string
	if v := os.Getenv("SLACK_MCP_ENABLED_TOOLS"); v != "" {
		for _, t := range strings.Split(v, ",") {
			enabled = append(enabled, strings.TrimSpace(t))
		}
	}
	s := server.NewMCPServer(provider.NewCatalogStub(), zap.NewNop(), enabled)
	if err := s.ServeStdio(); err != nil {
		os.Exit(1)
	}
}
`;

const SLACK_STUB = `package provider

import "github.com/slack-go/slack"

type catalogStub struct{ SlackAPI }

func (catalogStub) AuthTest() (*slack.AuthTestResponse, error) {
\treturn &slack.AuthTestResponse{URL: "https://example.slack.com/", Team: "example", User: "example"}, nil
}

func NewCatalogStub() *ApiProvider { return &ApiProvider{client: catalogStub{}} }
`;

export const SOURCES: Source[] = [
  {
    server: 'atlassian', repo: 'sooperset/mcp-atlassian', commit: 'a423ea579955bd4e00bf97ef64effea21f6ad1a3', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'Jira issues and Confluence pages', image: UV, install: `${UV_ENV}\nuv sync --frozen --no-dev`, run: ['.venv/bin/mcp-atlassian'],
    runEnv: { JIRA_URL: 'https://jira.example.com', JIRA_USERNAME: 'user@example.com', JIRA_API_TOKEN: P, CONFLUENCE_URL: 'https://wiki.example.com/wiki', CONFLUENCE_USERNAME: 'user@example.com', CONFLUENCE_API_TOKEN: P },
    coreFilter: { switch: 'ENABLED_TOOLS=confluence_search,confluence_get_page,confluence_get_page_children,confluence_create_page,confluence_update_page', env: { ENABLED_TOOLS: 'confluence_search,confluence_get_page,confluence_get_page_children,confluence_create_page,confluence_update_page' } },
  },
  { ...AWSLABS, server: 'cloudwatch', subdir: 'src/cloudwatch-mcp-server', job: 'AWS CloudWatch metrics, logs and alarms', run: ['.venv/bin/awslabs.cloudwatch-mcp-server'] },
  { ...AWSLABS, server: 'cloudtrail', subdir: 'src/cloudtrail-mcp-server', job: 'AWS CloudTrail event lookup', run: ['.venv/bin/awslabs.cloudtrail-mcp-server'] },
  { ...AWSLABS, server: 'aws-pricing', subdir: 'src/aws-pricing-mcp-server', job: 'AWS price lists and cost estimates', run: ['.venv/bin/awslabs.aws-pricing-mcp-server'] },
  { ...AWSLABS, server: 's3-tables', subdir: 'src/s3-tables-mcp-server', job: 'Amazon S3 Tables buckets, namespaces and tables', run: ['.venv/bin/awslabs.s3-tables-mcp-server'] },
  { ...AWSLABS, server: 'dynamodb', subdir: 'src/dynamodb-mcp-server', job: 'AWS DynamoDB tables and data modelling', run: ['.venv/bin/awslabs.dynamodb-mcp-server'] },
  { ...AWSLABS, server: 'iam', subdir: 'src/iam-mcp-server', job: 'AWS IAM users, roles and policies', run: ['.venv/bin/awslabs.iam-mcp-server'] },
  { ...AWSLABS, server: 'amazon-sns-sqs', subdir: 'src/amazon-sns-sqs-mcp-server', job: 'AWS SNS topics and SQS queues', run: ['.venv/bin/awslabs.amazon-sns-sqs-mcp-server'] },
  { ...ARCHIVED, server: 'aws-kb-retrieval', workdir: 'src/aws-kb-retrieval-server', job: 'Amazon Bedrock knowledge base retrieval', run: ['node', 'dist/index.js'], runEnv: { AWS_REGION: 'us-east-1' } },
  { ...ARCHIVED, server: 'everart', workdir: 'src/everart', job: 'image generation', run: ['node', 'dist/index.js'], runEnv: { EVERART_API_KEY: P } },
  {
    server: 'github', repo: 'github/github-mcp-server', commit: 'df32d7ec5786e0e71932767fce9982409cbaec40', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'code hosting: repositories, issues, pull requests', image: GO, install: 'go build -o /usr/local/bin/github-mcp-server ./cmd/github-mcp-server', run: ['github-mcp-server', 'stdio'],
    runEnv: { GITHUB_PERSONAL_ACCESS_TOKEN: P },
    coreFilter: { switch: '--tools list_issues,issue_write,create_pull_request,merge_pull_request,list_commits', args: ['--tools', 'list_issues,issue_write,create_pull_request,merge_pull_request,list_commits'] },
  },
  { ...ARCHIVED, server: 'gitlab', workdir: 'src/gitlab', job: 'code hosting: GitLab projects, issues, merge requests', run: ['node', 'dist/index.js'], runEnv: { GITLAB_PERSONAL_ACCESS_TOKEN: P } },
  { ...ARCHIVED, server: 'google-maps', workdir: 'src/google-maps', job: 'maps: geocoding, places, directions', run: ['node', 'dist/index.js'], runEnv: { GOOGLE_MAPS_API_KEY: P } },
  {
    server: 'grafana', repo: 'grafana/mcp-grafana', commit: '70b04944ed598cfa811d168d7b96a797fd3ee291', spdx: 'Apache-2.0', licenceFile: 'LICENSE',
    method: 'runtime', job: 'observability: dashboards, Prometheus, Loki, alerting, incidents', image: GO, install: 'go build -o /usr/local/bin/mcp-grafana ./cmd/mcp-grafana', run: ['mcp-grafana', '-t', 'stdio'],
    runEnv: { GRAFANA_URL: 'http://grafana.example.com:3000' },
    coreFilter: { switch: '--enabled-tools=incident', args: ['--enabled-tools=incident'] },
  },
  {
    server: 'heroku', repo: 'heroku/heroku-mcp-server', commit: '57c094c2a2e1b7b01f9ae8998bea3edc9fc214da', spdx: 'Apache-2.0', licenceFile: 'LICENSE.txt',
    method: 'runtime', job: 'Heroku apps, dynos, add-ons and Postgres', image: NODE, install: 'npm ci\nnpx tsc -p tsconfig.json', run: ['node', 'bin/heroku-mcp-server.mjs'], runEnv: { HEROKU_API_KEY: P },
  },
  {
    server: 'kubernetes', repo: 'containers/kubernetes-mcp-server', commit: '6e0b675bedb4c75e562ab100e408527c1bb10e0c', spdx: 'Apache-2.0', licenceFile: 'LICENSE',
    method: 'runtime', job: 'Kubernetes pods, resources and Helm', image: GO,
    install: 'go build -o /usr/local/bin/kubernetes-mcp-server ./cmd/kubernetes-mcp-server\nmkdir -p /root/.kube\nprintf "apiVersion: v1\\nkind: Config\\nclusters:\\n- name: example\\n  cluster:\\n    server: https://kubernetes.example.com\\ncontexts:\\n- name: example\\n  context:\\n    cluster: example\\n    user: example\\ncurrent-context: example\\nusers:\\n- name: example\\n  user: {}\\n" > /root/.kube/config',
    run: ['kubernetes-mcp-server'], runEnv: { HOME: '/root' },
  },
  {
    server: 'linear', repo: 'jerhadf/linear-mcp-server', commit: '5e2cb621c52762618eb015b4a8d6bf884021b29e', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'Linear issues', image: NODE, install: 'npm ci\nnpx tsc', run: ['node', 'build/index.js'], runEnv: { LINEAR_API_KEY: P },
  },
  {
    server: 'mattermost', repo: 'cloud-ru-tech/mcp-server-mattermost', commit: '8976ae4a77180bdeffdc3ffe20362bd253dc7cf8', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'team chat: Mattermost channels and posts', image: UV, install: `${UV_ENV}\nuv sync --frozen --no-dev`, run: ['.venv/bin/mcp-server-mattermost'],
    runEnv: { MATTERMOST_URL: 'https://chat.example.com', MATTERMOST_TOKEN: P },
  },
  {
    server: 'memory', ...MCP_SERVERS, workdir: 'src/memory', method: 'runtime', job: 'knowledge graph memory', image: NODE, buildGroup: 'mcp-servers-node',
    install: 'npm ci\nnpm run build -w src/memory', run: ['node', 'dist/index.js'], runEnv: { MEMORY_FILE_PATH: '/tmp/memory.jsonl' },
  },
  {
    server: 'mongodb', repo: 'mongodb-js/mongodb-mcp-server', commit: '2727403a2776d3dfc7f7d82866624633f5a4e1b4', spdx: 'Apache-2.0', licenceFile: 'LICENSE',
    method: 'runtime', job: 'MongoDB databases, collections and queries', image: NODE,
    install: `${PNPM('11.5.1')}\npnpm install --frozen-lockfile --ignore-scripts\npnpm --filter "mongodb-mcp-server..." run build`, workdir: 'packages/mongodb-mcp-server', run: ['node', 'dist/esm/index.js'],
    runEnv: { MDB_MCP_TELEMETRY: 'disabled' },
    coreFilter: { switch: 'MDB_MCP_DISABLED_TOOLS set to every tool except find, aggregate, insert-many, update-many and list-collections', env: { MDB_MCP_DISABLED_TOOLS: 'aggregate-db,collection-indexes,collection-schema,collection-storage-size,connect,count,create-collection,create-index,db-stats,delete-many,disconnect,drop-collection,drop-database,drop-index,explain,export,list-connections,list-databases,mongodb-logs,rename-collection,search-knowledge,list-knowledge-sources' } },
  },
  {
    server: 'notion', repo: 'makenotion/notion-mcp-server', commit: 'cf16e5c20bfbfb98ecec1227f210ef0ae3abebe5', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'Notion pages, databases and comments', image: NODE, install: 'npm ci\nnpm run build', run: ['node', 'bin/cli.mjs'], runEnv: { NOTION_TOKEN: P },
  },
  {
    server: 'playwright', repo: 'microsoft/playwright-mcp', commit: '2337aff0213d28db41d3e3daf48cee19b3d0bd82', spdx: 'Apache-2.0', licenceFile: 'LICENSE',
    method: 'runtime', job: 'browser automation', image: NODE, install: 'npm ci', run: ['node', 'cli.js', '--headless'],
  },
  { ...ARCHIVED, server: 'postgres', workdir: 'src/postgres', job: 'PostgreSQL read-only queries', run: ['node', 'dist/index.js', 'postgresql://db.example.com/app'] },
  {
    server: 'sentry', ...ARCHIVED, subdir: 'src/sentry', method: 'runtime', image: UV, buildGroup: undefined, install: `${UV_ENV}\nuv sync --frozen --no-dev`,
    job: 'Sentry error issues', run: ['.venv/bin/mcp-server-sentry', '--auth-token', P],
  },
  { ...ARCHIVED, server: 'slack-bot', workdir: 'src/slack', job: 'team chat: Slack channels and messages (reference server)', run: ['node', 'dist/index.js'], runEnv: { SLACK_BOT_TOKEN: P, SLACK_TEAM_ID: 'T00000000' } },
  {
    server: 'slack', repo: 'korotovsky/slack-mcp-server', commit: 'b88c0de3f706f4f07337c9eda7133c736d1c9524', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'team chat: Slack channels, threads and search', image: GO,
    staticVia: 'the stock binary calls Slack auth.test before it serves tools/list, so two small Go files added inside the sandbox (SLACK_SHIM and SLACK_STUB in sources.ts) build the server package\'s own NewMCPServer with a provider whose only working call is a canned auth.test answer for example.slack.com, and serve it on stdio; the tool definitions come from the pinned source unchanged, and no Slack call is made',
    install: `mkdir -p cmd/catalog-shim\ncat > cmd/catalog-shim/main.go <<'EOF'\n${SLACK_SHIM}EOF\ncat > pkg/provider/catalog_stub.go <<'EOF'\n${SLACK_STUB}EOF\ngo build -o /usr/local/bin/slack-catalog-shim ./cmd/catalog-shim`,
    run: ['slack-catalog-shim'],
    fullEnv: { SLACK_MCP_ADD_MESSAGE_TOOL: 'true', SLACK_MCP_REACTION_TOOL: 'true', SLACK_MCP_ATTACHMENT_TOOL: 'true', SLACK_MCP_MARK_TOOL: 'true' },
    coreFilter: { switch: 'SLACK_MCP_ENABLED_TOOLS=channels_list,conversations_history,conversations_add_message,conversations_search_messages', env: { SLACK_MCP_ENABLED_TOOLS: 'channels_list,conversations_history,conversations_add_message,conversations_search_messages' } },
  },
  {
    server: 'sqlite', ...ARCHIVED, subdir: 'src/sqlite', method: 'runtime', image: UV, buildGroup: undefined, install: `${UV_ENV}\nuv sync --frozen --no-dev`,
    job: 'SQLite queries and business notes', run: ['.venv/bin/mcp-server-sqlite', '--db-path', '/tmp/catalog.db'],
  },
  {
    server: 'teams', repo: 'floriscornel/teams-mcp', commit: 'b01182db9e450a2e3079bfa9a56d3e7f4e029693', spdx: 'MIT', licenceFile: 'LICENSE',
    method: 'runtime', job: 'team chat: Microsoft Teams chats and channels', image: NODE, install: 'npm ci\nnpx tsc', run: ['node', 'dist/index.js'],
  },
  {
    server: 'terraform', repo: 'hashicorp/terraform-mcp-server', commit: 'ffe13b794213caef56407b7f16809003882cccce', spdx: 'MPL-2.0', licenceFile: 'LICENSE',
    method: 'runtime', job: 'Terraform registry and HCP Terraform workspaces', image: GO, install: 'go build -o /usr/local/bin/terraform-mcp-server ./cmd/terraform-mcp-server', run: ['terraform-mcp-server', 'stdio'],
    coreFilter: { switch: '--tools=search_provider_docs,get_provider_details,search_modules,get_module_details,search_policies', args: ['--tools=search_provider_docs,get_provider_details,search_modules,get_module_details,search_policies'] },
  },
  { server: 'time', ...MCP_SERVERS, subdir: 'src/time', method: 'runtime', job: 'time zone lookup and conversion', image: UV, install: `${UV_ENV}\nuv sync --frozen --no-dev`, run: ['.venv/bin/mcp-server-time', '--local-timezone', 'UTC'] },
];

export const SURVEY_EXCLUDED: { repo: string; commit?: string; licence?: string; reason: string }[] = [
  { repo: 'getsentry/sentry-mcp', commit: 'e701040b064dda0824f23af129a832c9e8354ec1', licence: 'FSL-1.1-Apache-2.0', reason: 'Functional Source License, not OSI-approved; the MIT reference Sentry server from modelcontextprotocol/servers-archived is used instead' },
  { repo: 'stripe/agent-toolkit (now stripe/ai)', commit: '801ec2174acd581f71f99cf8df5383063824a1bc', licence: 'MIT', reason: 'no tool definitions in source: tools live on the hosted server at mcp.stripe.com, and the final local proxy (tag ai-packages-final, a3196df9) only forwards tools/list to it, which needs a Stripe key' },
  { repo: 'cloudflare/mcp-server-cloudflare', commit: 'a21972e219289337731a066befb5c66886b9ce7b', licence: 'Apache-2.0', reason: 'every app is a hosted Cloudflare Worker that lists tools only after OAuth; a static reader for its zod tool definitions was not built because the catalog reached 300 tools without it' },
  { repo: 'neondatabase/mcp-server-neon', commit: 'fffa2cf8ce08ff28d1962261f136cb6884362696', licence: 'MIT', reason: 'now a hosted Next.js app behind OAuth with no local stdio server; not captured for the same reason as Cloudflare' },
  { repo: 'v-3/discordmcp', commit: '39622af0333bcd324e811a2390146927517fb03d', reason: 'no licence file' },
  { repo: 'SaseQ/discord-mcp', commit: 'e134c03714cfadf786b686e3045b92537042a240', licence: 'MIT', reason: 'logs in to Discord before it serves tools/list (needs a bot token and the network), and its tools are Java annotations with no static reader; Mattermost and Teams stand in as second chat apps' },
  { repo: 'modelcontextprotocol/servers src/filesystem', licence: 'Apache-2.0 AND MIT', reason: 'duplicates the harness built-in file tools' },
  { repo: 'modelcontextprotocol/servers src/fetch', licence: 'Apache-2.0 AND MIT', reason: 'duplicates the harness built-in web fetch' },
  { repo: 'modelcontextprotocol/servers src/git', licence: 'Apache-2.0 AND MIT', reason: 'duplicates git on the local disk through the harness shell' },
  { repo: 'modelcontextprotocol/servers src/everything', licence: 'Apache-2.0 AND MIT', reason: 'a protocol test server, not a service anyone connects for work' },
  { repo: 'modelcontextprotocol/servers src/sequentialthinking', licence: 'Apache-2.0 AND MIT', reason: 'a reasoning aid rather than a service; a model may call it on any request, which would muddy the tool-when-none-needed outcome' },
  { repo: 'modelcontextprotocol/servers-archived src/brave-search', licence: 'MIT', reason: 'duplicates the harness built-in web search' },
  { repo: 'modelcontextprotocol/servers-archived src/puppeteer', licence: 'MIT', reason: 'archived browser server superseded by microsoft/playwright-mcp, which is in the catalog' },
  { repo: 'modelcontextprotocol/servers-archived src/github', licence: 'MIT', reason: 'archived and superseded by github/github-mcp-server, which is in the catalog' },
  { repo: 'modelcontextprotocol/servers-archived src/git', licence: 'MIT', reason: 'duplicates git on the local disk through the harness shell' },
  { repo: 'elastic/mcp-server-elasticsearch', commit: '9e64b842f22269eb214793e1a4885128dc4a8fd8', licence: 'Apache-2.0', reason: 'its build fetches a git dependency (elastic/elasticsearch-rs at a pinned revision) from github.com, outside the registry-only egress the capture allows' },
  { repo: 'modelcontextprotocol/servers-archived src/gdrive', commit: '9be4674d1ddf8c469e6461a27a337eeb65f76c2e', licence: 'MIT', reason: 'refuses to start without a Google OAuth credentials file; one tool, so no static reader was built' },
  { repo: 'modelcontextprotocol/servers-archived src/redis', commit: '9be4674d1ddf8c469e6461a27a337eeb65f76c2e', licence: 'MIT', reason: 'connects to a Redis server before it serves tools/list and exits when it cannot' },
  { repo: 'supabase-community/supabase-mcp', commit: '133b9f15e119135d3c2b362706d9ce3ef2014e99', licence: 'Apache-2.0', reason: 'answers tools/list only after a call to the Supabase management API with a real access token (fetch failed with the network off); its tool definitions are spread over feature modules with no static reader built' },
  { repo: 'awslabs/mcp (56 other servers)', commit: '07dd13a50f191297b4ad875e016de20d2266d521', licence: 'Apache-2.0', reason: 'seven servers for distinct AWS services were enough; aws-api-mcp-server in particular runs AWS CLI commands, close to a shell' },
];
