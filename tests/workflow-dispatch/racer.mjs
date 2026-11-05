import { openStore } from "../../tools/workflow-dispatch/store.mjs";
process.send({ kind: "barrier" });
process.once("message", async (q) => {
  let store;
  try {
    store = await openStore(q.options);
    await store.migrate(q.migration);
    const claim = await store.reserve(q.reservation);
    process.send({ kind: "result", status: "reserved", claim });
  } catch {
    process.send({ kind: "result", status: "rejected" });
  } finally {
    await new Promise((resolve) => process.once("message", resolve));
    await store?.close();
    process.disconnect();
  }
});
