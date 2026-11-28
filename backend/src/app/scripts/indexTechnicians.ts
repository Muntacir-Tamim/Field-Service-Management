import { prisma } from "../lib/prisma";
import { closeVectorStore } from "../lib/vectorStore";
import { reindexAllTechnicians } from "../module/chat/chat.indexer";

// Run once after the migration:  bun run index:technicians
const main = async () => {
  try {
    const count = await reindexAllTechnicians();
    console.log(`Indexed ${count} approved technicians`);
  } catch (error) {
    console.error("Indexing failed:", error);
    process.exitCode = 1;
  } finally {
    await closeVectorStore();
    await prisma.$disconnect();
  }
};

main();
