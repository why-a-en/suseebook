"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { orderItems } from "@/db/schema";

async function advance(
  orderItemId: string,
  from: "purchased" | "received" | "packed",
  to: "received" | "packed" | "completed",
  timestampColumn: "receivedAt" | "packedAt" | "completedAt",
) {
  await withCurrentOrganization(async ({ organizationId, tx }) => {
    await tx
      .update(orderItems)
      .set({ status: to, [timestampColumn]: new Date() })
      .where(
        and(
          eq(orderItems.id, orderItemId),
          eq(orderItems.organizationId, organizationId),
          eq(orderItems.status, from),
        ),
      );
  });
  revalidatePath("/parcels");
  revalidatePath("/purchase-queue");
}

export async function markReceivedAction(orderItemId: string) {
  await advance(orderItemId, "purchased", "received", "receivedAt");
}

export async function markPackedAction(orderItemId: string) {
  await advance(orderItemId, "received", "packed", "packedAt");
}

export async function markCompletedAction(orderItemId: string) {
  await advance(orderItemId, "packed", "completed", "completedAt");
}
