# Agent catalog — sources & attribution

The HIVE specialist catalog (`agentCatalog.json` + `scripts/agentCatalog.full.json`)
is merged from these collections, all under the MIT License. Each catalog entry
carries a `source` field identifying its origin. Rebuild with
`node scripts/build-agent-catalog.mjs` after cloning the sources to `/tmp`.

| source id | repository | license |
|-----------|------------|---------|
| `agency` | github.com/msitarzewski/agency-agents | MIT |
| `voltagent` | github.com/VoltAgent/awesome-claude-code-subagents | MIT |
| `wshobson` | github.com/wshobson/agents | MIT |
| `0xfurai` | github.com/0xfurai/claude-code-subagents | MIT |

MIT requires preserving the copyright and permission notice. Retain this file
and each upstream LICENSE when redistributing. No unlicensed collections (e.g.
contains-studio/agents, which has no license) are included.
