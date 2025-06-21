// Echo Runtime Agent - Tutorial Implementation
//
// This agent demonstrates the core patterns for building Anode runtime agents:
// 1. Connect to LiveStore for real-time collaboration
// 2. Register as a kernel with specific capabilities
// 3. React to execution requests via event subscriptions
// 4. Process cells and generate outputs
// 5. Handle graceful shutdown
//
// IMPORTANT: This agent assumes it will be the ONLY kernel for this notebook.
// Each notebook should have exactly one active kernel at a time.
// Multiple kernels per notebook only occur during brief transition periods.
//
// For code cells: echoes the input back
// For AI cells: responds with "Beep boop. You said '{input}'"

import { makeAdapter } from "npm:@livestore/adapter-node";
import { createStorePromise, queryDb } from "npm:@livestore/livestore";
import { makeCfSync } from "npm:@livestore/sync-cf";
import {
  events,
  type OutputType,
  type RichOutputData,
  schema,
  tables,
} from "jsr:@anode/draft-schema";
import { parseArgs } from "jsr:@std/cli/parse-args";

// Parse command line arguments
const args = parseArgs(Deno.args, {
  string: ["notebook", "auth-token", "sync-url", "kernel-id"],
  boolean: ["help"],
  alias: {
    n: "notebook",
    t: "auth-token",
    s: "sync-url",
    k: "kernel-id",
    h: "help",
  },
});

// Show help if requested
if (args.help) {
  console.log(`
🦕 Deno Runtime Agent for Anode

Usage:
  deno run --allow-net --allow-env main.ts [OPTIONS]

Required Options:
  --notebook, -n <id>        Notebook ID to connect to
  --auth-token, -t <token>   Authentication token for sync

Optional Options:
  --sync-url, -s <url>       WebSocket URL for LiveStore sync
                             (default: wss://anode-docworker.rgbkrk.workers.dev)
  --kernel-id, -k <id>       Unique kernel identifier
                             (default: deno-kernel-{pid})
  --help, -h                 Show this help message

Examples:
  deno run --allow-net --allow-env main.ts -n my-notebook -t your-token
  deno run --allow-net --allow-env main.ts --notebook=test --auth-token=abc123

Environment Variables (fallback):
  NOTEBOOK_ID, AUTH_TOKEN, LIVESTORE_SYNC_URL, KERNEL_ID
  `);
  Deno.exit(0);
}

// Configuration with CLI args taking precedence over environment variables
const NOTEBOOK_ID = args.notebook || Deno.env.get("NOTEBOOK_ID");
const AUTH_TOKEN = args["auth-token"] || Deno.env.get("AUTH_TOKEN");
const SYNC_URL = (args["sync-url"] || Deno.env.get("LIVESTORE_SYNC_URL")) ??
  "wss://anode-docworker.rgbkrk.workers.dev";
const KERNEL_ID = (args["kernel-id"] || Deno.env.get("KERNEL_ID")) ??
  `deno-kernel-${Deno.pid}`;

// Validation
if (!AUTH_TOKEN) {
  console.error("❌ AUTH_TOKEN is required.");
  console.error(
    "   Provide via: --auth-token <token> or AUTH_TOKEN environment variable",
  );
  console.error("   Use --help for more information");
  Deno.exit(1);
}

if (!NOTEBOOK_ID) {
  console.error("❌ NOTEBOOK_ID is required.");
  console.error(
    "   Provide via: --notebook <id> or NOTEBOOK_ID environment variable",
  );
  console.error(
    "   Example: deno run --allow-net --allow-env main.ts --notebook=my-notebook --auth-token=your-token",
  );
  console.error("   Use --help for more information");
  Deno.exit(1);
}

// Generate unique session ID for this kernel instance
const SESSION_ID = `${KERNEL_ID}-${Date.now()}-${
  Math.random().toString(36).slice(2)
}`;

// Startup message
console.log(`🦕 Starting echo agent for notebook: ${NOTEBOOK_ID}`);

// Create LiveStore adapter for real-time collaboration
// Each notebook gets its own store (storeId = notebookId)
const adapter = makeAdapter({
  storage: { type: "in-memory" },
  sync: {
    backend: makeCfSync({ url: SYNC_URL }),
    onSyncError: "ignore",
  },
});

const store = await createStorePromise({
  adapter,
  schema,
  storeId: NOTEBOOK_ID,
  syncPayload: {
    authToken: AUTH_TOKEN,
    kernel: true,
    kernelId: KERNEL_ID,
    sessionId: SESSION_ID,
  },
});

// Register this kernel session with the notebook
// This makes the kernel appear in the UI as "echo"
try {
  store.commit(events.kernelSessionStarted({
    sessionId: SESSION_ID,
    kernelId: KERNEL_ID,
    kernelType: "echo",
    capabilities: {
      canExecuteCode: true, // Can process code cells
      canExecuteSql: false, // No SQL support
      canExecuteAi: true, // Can process AI cells
    },
  }));

  // Send immediate heartbeat to show as "ready" in UI
  store.commit(events.kernelSessionHeartbeat({
    sessionId: SESSION_ID,
    status: "ready",
    timestamp: new Date(),
  }));

  console.log("✅ Connected and ready");
} catch (error) {
  console.error("❌ Failed to register kernel session:", error);
  throw error;
}

// Track shutdown state
let isShuttingDown = false;

// Track processed executions to prevent duplicates
const processedExecutions = new Set<string>();

// Generate unique IDs for outputs (required by LiveStore)
function generateUUID(): string {
  return crypto.randomUUID();
}

// Core execution handler - this is where the magic happens!
// Gets called when a cell needs to be executed
async function processExecution(queueEntry: { cellId: string; id: string }) {
  console.log(`⚡ Processing execution for cell ${queueEntry.cellId}`);

  // Small async placeholder for future extensibility
  await new Promise((resolve) => setTimeout(resolve, 0));

  const executionStartTime = new Date();

  try {
    // Get the cell data from LiveStore
    const cells = store.query(
      tables.cells.select().where({ id: queueEntry.cellId }),
    );
    const cell = cells[0];

    if (!cell) {
      throw new Error(`Cell ${queueEntry.cellId} not found`);
    }

    // Mark execution as started (updates UI state)
    store.commit(events.executionStarted({
      queueId: queueEntry.id,
      cellId: queueEntry.cellId,
      kernelSessionId: SESSION_ID,
      startedAt: executionStartTime,
    }));

    // Clear any previous outputs from this cell
    store.commit(events.cellOutputsCleared({
      cellId: cell.id,
      clearedBy: `kernel-${KERNEL_ID}`,
    }));

    let outputData: {
      type: OutputType;
      data: RichOutputData;
      metadata: Record<string, unknown>;
    };

    if (cell.cellType === "ai") {
      // AI cell: respond with silly bot message
      outputData = {
        type: "execute_result",
        data: {
          "text/plain": `Beep boop. You said "${cell.source || ""}"`,
        },
        metadata: {},
      };
    } else {
      // Code cell: echo the input back (demo behavior)
      outputData = {
        type: "execute_result",
        data: {
          "text/plain": cell.source || "",
        },
        metadata: {},
      };
    }

    // Add the output to the cell (appears in UI)
    store.commit(events.cellOutputAdded({
      id: generateUUID(),
      cellId: cell.id,
      outputType: outputData.type,
      data: outputData.data,
      metadata: outputData.metadata,
      position: 0,
    }));

    // Mark execution as completed (updates UI state)
    const executionEndTime = new Date();
    const executionDurationMs = executionEndTime.getTime() -
      executionStartTime.getTime();

    store.commit(events.executionCompleted({
      queueId: queueEntry.id,
      cellId: queueEntry.cellId,
      status: "success",
      completedAt: executionEndTime,
      executionDurationMs: executionDurationMs,
    }));

    console.log(`✅ Execution completed in ${executionDurationMs}ms`);
  } catch (error) {
    console.error(`❌ Error in execution:`, error);

    // Mark execution as failed
    try {
      const executionEndTime = new Date();
      const executionDurationMs = executionEndTime.getTime() -
        executionStartTime.getTime();

      store.commit(events.executionCompleted({
        queueId: queueEntry.id,
        cellId: queueEntry.cellId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        completedAt: executionEndTime,
        executionDurationMs: executionDurationMs,
      }));
    } catch (commitError) {
      console.error(`💥 Failed to mark execution as failed:`, commitError);
    }
  }
}

// Set up reactive queries - these automatically update when data changes
// This is the key to LiveStore's real-time collaboration

// Watch for work that needs to be claimed
const pendingWorkQuery$ = queryDb(
  tables.executionQueue.select()
    .where({ status: "pending" })
    .orderBy("priority", "desc"),
  {
    label: "pendingWork",
  },
);

// Watch for active kernels (for coordination)
const activeKernelsQuery$ = queryDb(
  tables.kernelSessions.select()
    .where({ isActive: true }),
  {
    label: "activeKernels",
  },
);

// Watch for work assigned to this specific kernel
const assignedWorkQuery$ = queryDb(
  tables.executionQueue.select()
    .where({
      status: "assigned",
      assignedKernelSession: SESSION_ID,
    })
    .orderBy("priority", "desc"),
  {
    label: "assignedWork",
    deps: [SESSION_ID], // React when our session changes
  },
);

// Set up subscriptions
let assignedWorkSubscription: (() => void) | null = null;
let pendingWorkSubscription: (() => void) | null = null;
let activeKernelsSubscription: (() => void) | null = null;

// Subscribe to assigned work - this is where we actually do the work!
assignedWorkSubscription = store.subscribe(assignedWorkQuery$, {
  onUpdate: (entries) => {
    if (isShuttingDown) return;

    // Process each assigned execution
    setTimeout(async () => {
      for (const queueEntry of entries) {
        // Skip if already processed (prevent duplicates)
        if (processedExecutions.has(queueEntry.id)) {
          continue;
        }

        // Mark as processed immediately
        processedExecutions.add(queueEntry.id);

        try {
          await processExecution(queueEntry);
        } catch (error) {
          console.error(
            `❌ Error processing execution ${queueEntry.id}:`,
            error,
          );
        }
      }
    }, 0);
  },
});

// Subscribe to pending work - this is how we claim new work to do
pendingWorkSubscription = store.subscribe(pendingWorkQuery$, {
  onUpdate: (entries) => {
    if (isShuttingDown) return;

    if (entries.length > 0) {
      console.log(`📋 ${entries.length} pending execution(s)`);
    }

    // Try to claim pending work (should be sole kernel, but handle transitions)
    setTimeout(() => {
      // Check if our kernel is ready to take work (we should be the only one)
      const activeKernels = store.query(
        activeKernelsQuery$,
      );
      const ourKernel = activeKernels.find((k) => k.sessionId === SESSION_ID);

      if (!ourKernel) {
        return;
      }

      // Try to claim the first available execution
      const firstPending = entries[0];
      if (firstPending && firstPending.status === "pending") {
        try {
          store.commit(events.executionAssigned({
            queueId: firstPending.id,
            kernelSessionId: SESSION_ID,
          }));
        } catch (_error) {
          // Silently fail - another kernel may have claimed it
        }
      }
    }, 0);
  },
});

// Subscribe to active kernels (mainly for transition state monitoring)
activeKernelsSubscription = store.subscribe(activeKernelsQuery$, {
  onUpdate: (_entries) => {
    if (isShuttingDown) return;
    // In a full implementation, this would detect multiple kernels and handle handoffs
  },
});

// Heartbeat mechanism - keeps the kernel alive in the UI
const heartbeatInterval = setInterval(() => {
  if (isShuttingDown) return;

  try {
    store.commit(events.kernelSessionHeartbeat({
      sessionId: SESSION_ID,
      status: "ready",
      timestamp: new Date(),
    }));
  } catch (error) {
    console.warn("⚠️ Heartbeat failed:", error);
  }
}, 15000); // Every 15 seconds

// Graceful shutdown - clean up resources and notify other kernels
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("🛑 Shutting down...");

  // Stop heartbeat
  clearInterval(heartbeatInterval);

  // Unsubscribe from all reactive queries
  if (assignedWorkSubscription) {
    assignedWorkSubscription();
    assignedWorkSubscription = null;
  }

  if (pendingWorkSubscription) {
    pendingWorkSubscription();
    pendingWorkSubscription = null;
  }

  if (activeKernelsSubscription) {
    activeKernelsSubscription();
    activeKernelsSubscription = null;
  }

  // Tell other kernels we're shutting down
  try {
    store.commit(events.kernelSessionTerminated({
      sessionId: SESSION_ID,
      reason: "shutdown",
    }));
  } catch (error) {
    console.warn("⚠️ Failed to mark session as terminated:", error);
  }

  // Close LiveStore connection
  await store.shutdown?.();

  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Handle uncaught errors by shutting down cleanly
globalThis.addEventListener("unhandledrejection", (event) => {
  console.error("💥 Unhandled rejection:", event.reason);
  shutdown();
});

globalThis.addEventListener("error", (event) => {
  console.error("💥 Uncaught error:", event.error);
  shutdown();
});

console.log("🔌 Press Ctrl+C to stop");

// Keep process alive until shutdown
while (!isShuttingDown) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
