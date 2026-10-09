# Privacy and local data

Workhub reads Markdown task files only in explicitly connected workspaces.
New installations have no default connections. The connection registry stores
workspace names and absolute paths in the user's local application-data directory,
outside the project checkout. The registry also stores the chosen accent color.
`TODO_CONFIG` can select another registry location.
Disconnecting removes the connection, not the task files.

The server communicates through stdio MCP. It has no public task-data endpoint,
analytics, telemetry, or task-service account. The development preview binds to
loopback, restricts browser origins, and requires a per-process request token.
Workhub does not execute scripts from connected workspaces.

Tool results include task content and local paths. Codex or another MCP host may
send those results to its model provider and retain them in chats or logs under
that host's policies. Workhub's local execution does not imply that using it
with an AI host keeps task content entirely on the device.

Undo history is held in memory for the current server session. Tasks and archives
remain files in the connected workspace. Tests use synthetic temporary fixtures;
they do not read the user's actual task registry or publish task data.

Keep credentials, private task files, local registries, screenshots of real
workspaces, and deployment artifacts outside this repository. Review reports and
screenshots before posting a GitHub issue. Dependencies retain their upstream
license notices; those notices are public attribution, not application user data.
