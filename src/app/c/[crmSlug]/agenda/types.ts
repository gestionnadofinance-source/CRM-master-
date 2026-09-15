import type { listAppointmentsInRange } from "@/server/agenda/actions";
import type { listTasksInRange } from "@/server/tasks/actions";
import type { AccessCategory } from "@prisma/client";

export type AgendaAppointment = Awaited<ReturnType<typeof listAppointmentsInRange>>[number];
export type AgendaTask = Awaited<ReturnType<typeof listTasksInRange>>[number];

export type AgendaView = "day" | "week" | "month";

export interface AgendaMember {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
  category: AccessCategory | null;
  isGlobalAdmin: boolean;
}
