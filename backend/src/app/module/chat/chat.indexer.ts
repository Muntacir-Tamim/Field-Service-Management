import { Document } from "@langchain/core/documents";
import { prisma } from "../../lib/prisma";
import { getVectorStore } from "../../lib/vectorStore";

const INDEX_BATCH_SIZE = 20;

const indexableSelect = {
  id: true,
  name: true,
  address: true,
  bio: true,
  experienceYears: true,
  skills: {
    select: {
      level: true,
      skill: { select: { name: true, category: true, isDeleted: true } },
    },
  },
} as const;

// Only approved, active, not-deleted technicians are searchable.
const eligibleWhere = {
  isDeleted: false,
  verificationStatus: "APPROVED",
  user: { isDeleted: false, status: "ACTIVE" },
} as const;

type TIndexableTechnician = {
  id: string;
  name: string;
  address: string | null;
  bio: string | null;
  experienceYears: number;
  skills: {
    level: string;
    skill: { name: string; category: string; isDeleted: boolean };
  }[];
};

// No email / phone here: this text is sent to the embeddings API.
export const buildTechnicianDocument = (t: TIndexableTechnician) => {
  const skills = t.skills
    .filter((s) => !s.skill.isDeleted)
    .map((s) => `${s.skill.name} (${s.level}, ${s.skill.category})`)
    .join(", ");

  return new Document({
    pageContent: [
      `Technician: ${t.name}`,
      skills ? `Skills: ${skills}` : "",
      `Experience: ${t.experienceYears} years`,
      t.address ? `Location: ${t.address}` : "",
      t.bio ? `About: ${t.bio}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: { technicianId: t.id },
  });
};

export const upsertTechnicianEmbedding = async (technicianId: string) => {
  const store = getVectorStore();

  const technician = await prisma.technician.findFirst({
    where: { id: technicianId, ...eligibleWhere },
    select: indexableSelect,
  });

  await store.delete({ ids: [technicianId] });
  if (!technician) return;

  await store.addDocuments([buildTechnicianDocument(technician)], {
    ids: [technician.id],
  });
};

// Fire-and-forget helper for services: never breaks the main request.
export const syncTechnicianEmbedding = (technicianId: string) => {
  upsertTechnicianEmbedding(technicianId).catch((error) =>
    console.error("Chat: failed to index technician", error),
  );
};

export const reindexAllTechnicians = async () => {
  const store = getVectorStore();

  const technicians = await prisma.technician.findMany({
    where: eligibleWhere,
    select: indexableSelect,
  });

  await prisma.technicianEmbedding.deleteMany({
    where: { id: { notIn: technicians.map((t) => t.id) } },
  });

  for (let i = 0; i < technicians.length; i += INDEX_BATCH_SIZE) {
    const batch = technicians.slice(i, i + INDEX_BATCH_SIZE);
    const ids = batch.map((t) => t.id);

    await store.delete({ ids });
    await store.addDocuments(batch.map(buildTechnicianDocument), { ids });
  }

  return technicians.length;
};
