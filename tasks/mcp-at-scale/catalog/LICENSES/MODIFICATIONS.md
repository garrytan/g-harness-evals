# Modification notices

Every file under servers/ holds tool definitions (names, descriptions, input schemas and annotations) and the initialize result that the named server returned at the named commit, captured as described in ../README.md. The definitions are reproduced unchanged. Nothing from these servers runs in our tests: a fake server built by Harness Evals replays the definitions and answers from scripted fixtures.

These are the changes we made to what each server offers. They count as modifications under section 4(b) of the Apache License 2.0 and are listed here for every server, whatever its licence.

- **atlassian** (sooperset/mcp-atlassian at a423ea579955, MIT): Trimmed to 5 of its 96 tools in every rung (confluence_search, confluence_get_page, confluence_get_page_children, confluence_create_page, confluence_update_page), the set a user gets with: ENABLED_TOOLS=confluence_search,confluence_get_page,confluence_get_page_children,confluence_create_page,confluence_update_page. Served under the server name `atlassian` by our fake server.
- **cloudwatch** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `cloudwatch` by our fake server.
- **cloudtrail** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `cloudtrail` by our fake server.
- **aws-pricing** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `aws-pricing` by our fake server.
- **s3-tables** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `s3-tables` by our fake server.
- **dynamodb** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `dynamodb` by our fake server.
- **iam** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `iam` by our fake server.
- **amazon-sns-sqs** (awslabs/mcp at 07dd13a50f19, Apache-2.0): Served under the server name `amazon-sns-sqs` by our fake server.
- **aws-kb-retrieval** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `aws-kb-retrieval` by our fake server.
- **everart** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `everart` by our fake server.
- **github** (github/github-mcp-server at df32d7ec5786, MIT): Trimmed to 5 of its 46 tools in every rung (list_issues, issue_write, create_pull_request, merge_pull_request, list_commits), the set a user gets with: --tools list_issues,issue_write,create_pull_request,merge_pull_request,list_commits. Served under the server name `github` by our fake server.
- **gitlab** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `gitlab` by our fake server.
- **google-maps** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `google-maps` by our fake server.
- **grafana** (grafana/mcp-grafana at 70b04944ed59, Apache-2.0): Trimmed to 6 of its 80 tools in every rung (add_activity_to_incident, create_incident, get_incident, list_incident_custom_fields, list_incidents, update_incident), the set a user gets with: --enabled-tools=incident. Served under the server name `grafana` by our fake server.
- **heroku** (heroku/heroku-mcp-server at 57c094c2a2e1, Apache-2.0): Served under the server name `heroku` by our fake server.
- **kubernetes** (containers/kubernetes-mcp-server at 6e0b675bedb4, Apache-2.0): Served under the server name `kubernetes` by our fake server.
- **linear** (jerhadf/linear-mcp-server at 5e2cb621c527, MIT): Served under the server name `linear` by our fake server.
- **mattermost** (cloud-ru-tech/mcp-server-mattermost at 8976ae4a7718, MIT): Served under the server name `mattermost` by our fake server.
- **memory** (modelcontextprotocol/servers at c799c8552b0f, Apache-2.0 AND MIT): Served under the server name `memory` by our fake server.
- **mongodb** (mongodb-js/mongodb-mcp-server at 2727403a2776, Apache-2.0): Trimmed to 5 of its 27 tools in every rung (aggregate, find, insert-many, list-collections, update-many), the set a user gets with: MDB_MCP_DISABLED_TOOLS set to every other tool name (22 names, listed in servers/mongodb.json core_filter). Served under the server name `mongodb` by our fake server.
- **notion** (makenotion/notion-mcp-server at cf16e5c20bfb, MIT): Served under the server name `notion` by our fake server.
- **playwright** (microsoft/playwright-mcp at 2337aff0213d, Apache-2.0): Served under the server name `playwright` by our fake server.
- **postgres** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `postgres` by our fake server.
- **sentry** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `sentry` by our fake server.
- **slack-bot** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `slack-bot` by our fake server.
- **slack** (korotovsky/slack-mcp-server at b88c0de3f706, MIT): Trimmed to 4 of its 22 tools in every rung (channels_list, conversations_history, conversations_add_message, conversations_search_messages), the set a user gets with: SLACK_MCP_ENABLED_TOOLS=channels_list,conversations_history,conversations_add_message,conversations_search_messages. Served under the server name `slack` by our fake server.
- **sqlite** (modelcontextprotocol/servers-archived at 9be4674d1ddf, MIT): Served under the server name `sqlite` by our fake server.
- **teams** (floriscornel/teams-mcp at b01182db9e45, MIT): Served under the server name `teams` by our fake server.
- **terraform** (hashicorp/terraform-mcp-server at ffe13b794213, MPL-2.0): Trimmed to 5 of its 10 tools in every rung (search_provider_docs, get_provider_details, search_modules, get_module_details, search_policies), the set a user gets with: --tools=search_provider_docs,get_provider_details,search_modules,get_module_details,search_policies. Served under the server name `terraform` by our fake server.
- **time** (modelcontextprotocol/servers at c799c8552b0f, Apache-2.0 AND MIT): Served under the server name `time` by our fake server.
