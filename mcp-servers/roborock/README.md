# Roborock MCP

Roborock ships no official MCP server, so this is the thin wrapper the
architecture rules ask for (`spec 0.1`): application code never calls the robot's
API — it calls these tools.

## Tools

| Tool | What it does |
|---|---|
| `get_status` | battery, current state, error, and the last finished clean with `days_ago` |
| `start_clean` | starts a full clean (`app_start`) |
| `stop_clean(return_to_dock=true)` | stops the clean (`app_stop`) and sends the robot home (`app_charge`) |

Every tool answers with an object carrying `ok`. On failure it returns
`{"ok": false, "error": "..."}` rather than raising, so the brief can hide the
robot section instead of failing the whole run.

## Install

```bash
python -m pip install -r mcp-servers/roborock/requirements.txt
```

## Run

The agent host starts it for you from `config.yaml`. To run it by hand:

```bash
ROBOROCK_USERNAME=... ROBOROCK_PASSWORD=... \
PYTHONPATH=mcp-servers/roborock python -m roborock_mcp
```

| Variable | Required | Meaning |
|---|---|---|
| `ROBOROCK_USERNAME` | yes | the email on the Roborock app account |
| `ROBOROCK_PASSWORD` | yes | that account's password |
| `ROBOROCK_DEVICE_NAME` | no | substring of the robot's name, when the account has several |
| `ROBOROCK_MCP_LOG` | no | log level, default `WARNING` |

Accounts that sign in with an emailed code rather than a password cannot use
`pass_login`; set a password in the Roborock app first.

The server keeps nothing on disk. It logs in per process, holds the connection
while the agent run lasts, and forgets everything when it exits.
