import { format } from "date-fns";
import { cacheGetOrSet } from "../../lib/cache";
import { prisma } from "../../lib/prisma";
import { getVectorStore } from "../../lib/vectorStore";
import config from "../../config";

const TOP_K_TECHNICIANS = 4;
const MAX_SKILLS_IN_PROMPT = 80;
const SKILLS_CACHE_TTL = 300; // 5 minutes

const fmt = (date: Date) => format(date, "d MMM yyyy, h:mm a");

export const RESTRICTED_TECHNICIANS_TEXT =
  "Technician profiles are not available to this user.";

/* ----------------------------- skills catalogue ---------------------------- */

// Safe for everyone: skill names + how many approved technicians exist (no names).
export const getSkillsText = async () => {
  const skills = await cacheGetOrSet("chat:skills", SKILLS_CACHE_TTL, () =>
    prisma.skill.findMany({
      where: { isDeleted: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: MAX_SKILLS_IN_PROMPT,
      select: {
        name: true,
        category: true,
        description: true,
        _count: {
          select: {
            technicians: {
              where: {
                technician: {
                  isDeleted: false,
                  verificationStatus: "APPROVED",
                  isAvailable: true,
                },
              },
            },
          },
        },
      },
    }),
  );

  if (!skills.length) return "No services are listed yet.";

  return skills
    .map(
      (s) =>
        `- ${s.name} [${s.category}]${s.description ? `: ${s.description}` : ""} (${s._count.technicians} technicians currently available)`,
    )
    .join("\n");
};

/* ------------------------- technicians (ADMIN only) ------------------------ */

export const retrieveTechnicianIds = async (searchQuery: string) => {
  const results = await getVectorStore().similaritySearchWithScore(
    searchQuery,
    TOP_K_TECHNICIANS,
  );

  return results
    .filter(
      ([, distance]) =>
        config.chat_max_distance === undefined ||
        distance <= config.chat_max_distance,
    )
    .map(([doc]) => doc.metadata.technicianId as string);
};

const getTechniciansLive = async (ids: string[]) => {
  if (!ids.length) return [];

  const technicians = await prisma.technician.findMany({
    where: {
      id: { in: ids },
      isDeleted: false,
      verificationStatus: "APPROVED",
      user: { isDeleted: false, status: "ACTIVE" },
    },
    select: {
      id: true,
      name: true,
      address: true,
      bio: true,
      experienceYears: true,
      isAvailable: true,
      skills: {
        select: { level: true, skill: { select: { name: true } } },
      },
      _count: {
        select: {
          assignments: {
            where: { status: "CONFIRMED", scheduledStart: { gte: new Date() } },
          },
        },
      },
    },
  });

  const ratings = await Promise.all(
    technicians.map((t) =>
      prisma.customerFeedback.aggregate({
        where: {
          isDeleted: false,
          serviceRequest: {
            assignments: { some: { technicianId: t.id, status: "CONFIRMED" } },
          },
        },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ),
  );

  // keep the similarity order
  return ids
    .map((id) => {
      const index = technicians.findIndex((t) => t.id === id);
      return index === -1
        ? null
        : { technician: technicians[index], rating: ratings[index] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
};

export const getTechniciansText = async (ids: string[]) => {
  const rows = await getTechniciansLive(ids);
  if (!rows.length) return "No matching technicians were found.";

  return rows
    .map(({ technician: t, rating }, index) => {
      const avg = rating._avg.rating
        ? `${rating._avg.rating.toFixed(1)}/5 from ${rating._count.rating} reviews`
        : "no reviews yet";
      return [
        `Technician ${index + 1}: ${t.name} (id: ${t.id})`,
        `- Skills: ${t.skills.map((s) => `${s.skill.name} (${s.level})`).join(", ") || "none listed"}`,
        `- Experience: ${t.experienceYears} years`,
        `- Currently available: ${t.isAvailable ? "yes" : "no"}`,
        `- Upcoming confirmed jobs: ${t._count.assignments}`,
        `- Rating: ${avg}`,
        t.address ? `- Location: ${t.address}` : "",
        t.bio ? `- About: ${t.bio}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
};

/* --------------------------- the user's own data --------------------------- */

const getCustomerText = async (userId: string) => {
  const customer = await prisma.customer.findFirst({
    where: { userId, isDeleted: false },
    select: { id: true },
  });
  if (!customer) return "No customer profile found.";

  const requests = await prisma.serviceRequest.findMany({
    where: { customerId: customer.id, isDeleted: false },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      title: true,
      status: true,
      priority: true,
      createdAt: true,
      preferredDate: true,
      rejectionReason: true,
      assignments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          technician: { select: { name: true } },
          workOrder: {
            select: {
              status: true,
              payment: {
                select: {
                  status: true,
                  totalAmount: true,
                  currency: true,
                  invoiceNumber: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!requests.length) return "The customer has no service requests yet.";

  return `The customer's ${requests.length} most recent service requests:\n${requests
    .map((r, i) => {
      const a = r.assignments[0];
      const lines = [
        `Request ${i + 1}: "${r.title}" - status ${r.status}, priority ${r.priority}, created ${fmt(r.createdAt)}`,
        r.rejectionReason ? `  Rejected because: ${r.rejectionReason}` : "",
        a
          ? `  Assignment: ${a.status}, technician ${a.technician.name}, ${fmt(a.scheduledStart)} to ${fmt(a.scheduledEnd)}`
          : "  Assignment: none yet",
        a?.workOrder ? `  Work order: ${a.workOrder.status}` : "",
        a?.workOrder?.payment
          ? `  Invoice ${a.workOrder.payment.invoiceNumber}: ${a.workOrder.payment.status}, ${a.workOrder.payment.totalAmount.toString()} ${a.workOrder.payment.currency}`
          : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n")}`;
};

const getTechnicianText = async (userId: string) => {
  const technician = await prisma.technician.findFirst({
    where: { userId, isDeleted: false },
    select: { id: true },
  });
  if (!technician) return "No technician profile found.";

  const assignments = await prisma.assignment.findMany({
    where: {
      technicianId: technician.id,
      status: { in: ["PENDING", "CONFIRMED"] },
      scheduledEnd: { gte: new Date() },
    },
    orderBy: { scheduledStart: "asc" },
    take: 5,
    select: {
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      serviceRequest: { select: { title: true, city: true, address: true } },
      workOrder: { select: { status: true } },
    },
  });

  if (!assignments.length) return "The technician has no upcoming assignments.";

  return `The technician's next ${assignments.length} assignments:\n${assignments
    .map(
      (a, i) =>
        `Job ${i + 1}: "${a.serviceRequest.title}" at ${a.serviceRequest.address}, ${a.serviceRequest.city} - ${a.status}, ${fmt(a.scheduledStart)} to ${fmt(a.scheduledEnd)}${a.workOrder ? `, work order ${a.workOrder.status}` : ""}`,
    )
    .join("\n")}`;
};

export const getUserDataText = async (
  role: string | undefined,
  userId: string | undefined,
) => {
  if (!userId)
    return "The user is not logged in, so no personal data is available.";
  if (role === "CUSTOMER") return getCustomerText(userId);
  if (role === "TECHNICIAN") return getTechnicianText(userId);
  return "No personal data is attached for this role.";
};
