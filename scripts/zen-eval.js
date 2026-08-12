// Evaluate JavaScript in a tab of a running Zen/Firefox, over WebDriver BiDi.
//
// Zen is a Firefox fork, so nothing that drives Chrome can inspect it, and
// Playwright only attaches to its own patched build. Firefox's remote agent is
// the way in: launch with `ZEN_DEBUG_PORT=9222 npm run start:zen`, then ask the
// live page questions instead of asking a human to copy console output.
//
// Node's global WebSocket does the talking, so there is nothing to install.
//
// Usage:
//   node scripts/zen-eval.js '<expression>'            # first reddit tab
//   node scripts/zen-eval.js --url-match=redgifs '...' # tab whose URL matches
//   node scripts/zen-eval.js --list                    # just list the tabs
//
// The expression is evaluated in the page and its value returned. Return a
// string (JSON.stringify) for anything structured — BiDi's own serialization
// of deep objects is unwieldy.
//
// Firefox permits one active session at a time and only releases it when the
// client disconnects cleanly. A run killed mid-flight (Ctrl-C, a timeout)
// leaves it held, and every later run fails with "Maximum number of active
// sessions" until Zen is restarted.

const PORT = process.env.ZEN_DEBUG_PORT || 9222;
const ENDPOINT = `ws://127.0.0.1:${PORT}/session`;

const args = process.argv.slice(2);
const list = args.includes("--list");
const matchArg = args.find((a) => a.startsWith("--url-match="));
const urlMatch = matchArg ? matchArg.split("=").slice(1).join("=") : "reddit.com";
const expression = args.filter((a) => !a.startsWith("--")).join(" ");

if (!list && !expression) {
  console.error("Nothing to evaluate. Pass an expression, or --list.");
  process.exit(2);
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT);
    const pending = new Map();
    let nextId = 1;

    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close: () => ws.close(),
      })
    );

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const waiter = pending.get(msg.id);
      if (!waiter) return; // an event, not a command result
      pending.delete(msg.id);
      if (msg.type === "error") {
        waiter.rej(new Error(`${msg.error}: ${msg.message}`));
      } else {
        waiter.res(msg.result);
      }
    });

    ws.addEventListener("error", () =>
      reject(
        new Error(
          `Could not reach Zen's remote agent at ${ENDPOINT}.\n` +
            `Start it with:  ZEN_DEBUG_PORT=${PORT} npm run start:zen`
        )
      )
    );
  });
}

function flatten(node, out = []) {
  out.push(node);
  (node.children || []).forEach((child) => flatten(child, out));
  return out;
}

// Firefox allows exactly one active BiDi session, so a run that died without
// ending its own would lock out every run after it.
async function startSession(session) {
  try {
    return await session.send("session.new", { capabilities: {} });
  } catch (e) {
    if (!/Maximum number of active sessions/i.test(e.message)) throw e;
    await session.send("session.end", {}).catch(() => {});
    return session.send("session.new", { capabilities: {} });
  }
}

async function main() {
  const session = await connect();
  try {
    await run(session);
  } finally {
    await session.send("session.end", {}).catch(() => {});
    session.close();
  }
}

async function run(session) {
  await startSession(session);

  const tree = await session.send("browsingContext.getTree", {});
  const contexts = tree.contexts.flatMap((c) => flatten(c));

  if (list) {
    contexts.forEach((c) => console.log(`${c.context}  ${c.url}`));
    return;
  }

  const target = contexts.find((c) => (c.url || "").includes(urlMatch));
  if (!target) {
    console.error(`No tab matching "${urlMatch}". Open one, or try --list.`);
    console.error(contexts.map((c) => `  ${c.url}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  const result = await session.send("script.evaluate", {
    expression,
    target: { context: target.context },
    awaitPromise: true,
    resultOwnership: "none",
  });

  if (result.type === "exception") {
    console.error("Exception in page:", result.exceptionDetails.text);
    process.exitCode = 1;
    return;
  }

  const value = result.result;
  console.log(value.type === "string" ? value.value : JSON.stringify(value, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
