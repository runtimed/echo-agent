# Echo Runtime Agent

A tutorial implementation of an Anode runtime agent using Deno. This agent demonstrates the basic patterns for connecting to LiveStore and processing notebook cells.

## What This Agent Does

- **Code cells**: Echoes back the input code as plain text
- **AI cells**: Responds with "Beep boop. You said '{input}'"
- Appears as "echo" kernel in the Anode notebook UI
- Demonstrates the LiveStore event-driven execution flow

NOTE: You must be running your own copy of anode with your own `AUTH_TOKEN` env var set in the shell or in a `.env` file. Alternatively, use `--auth-token=YOUR_TOKEN`. Additionally, you may need to set the `--sync-url` to your running anode instance.

## Quick Start

1. **Get notebook ID and token from your Anode UI**

2. **Run the agent:**
```bash
deno run --allow-all --env-file main.ts --notebook=YOUR_NOTEBOOK_ID
```

2. **Or compile to binary:**
```bash
deno compile --allow-all --env-file -o echo-agent main.ts
./echo-agent --notebook=YOUR_NOTEBOOK_ID
```

## Key Patterns

- **Event-sourced**: Everything flows through LiveStore events
- **Reactive**: Uses `queryDb()` subscriptions to keep up to date state

## Next Steps

Fork this to build your own runtime agent:
- Execute actual JavaScript/TypeScript code
- Add rich output formatting (HTML, images, etc.)
- Integrate with databases, APIs, or AI services
- Add custom cell types and capabilities
