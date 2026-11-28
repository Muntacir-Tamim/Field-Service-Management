import cron from "node-cron";
import { reindexAllTechnicians } from "../module/chat/chat.indexer";

let running = false;

const runReindex = async () => {
  if (running) return;
  running = true;

  try {
    const count = await reindexAllTechnicians();
    console.log(
      `[technicianReindex] indexed ${count} technicians for the chatbot`,
    );
  } catch (error) {
    console.error("[technicianReindex] job failed:", error);
  } finally {
    running = false;
  }
};

// Safety net: also fixes changes that have no direct hook (skill renamed/deleted, user blocked/deleted ...)
export const startTechnicianReindexJob = () => {
  cron.schedule("0 3 * * *", runReindex);
  console.log("Technician reindex job started (daily at 03:00).");
};
