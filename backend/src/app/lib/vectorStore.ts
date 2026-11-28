import { PGVectorStore } from "@langchain/pgvector";
import pg from "pg";
import config from "../config";
import { getEmbeddings } from "./llm";

let pool: pg.Pool | null = null;
let store: PGVectorStore | null = null;

// Lazy: no DB pool / embeddings client is created until the chatbot is really used.
export const getVectorStore = () => {
  if (store) return store;

  pool = new pg.Pool({
    connectionString: config.database_url,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on("error", (error) => {
    console.error(
      "Vector store: idle database connection error",
      error.message,
    );
  });

  store = new PGVectorStore(getEmbeddings(), {
    pool,
    tableName: "technician_embeddings",
    columns: {
      idColumnName: "id",
      vectorColumnName: "embedding",
      contentColumnName: "content",
      metadataColumnName: "metadata",
    },
    distanceStrategy: "cosine",
  });

  return store;
};

export const closeVectorStore = async () => {
  if (store) await store.end();
  store = null;
  pool = null;
};
