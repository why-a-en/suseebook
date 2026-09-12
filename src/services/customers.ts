import { customers } from "@/db/schema";
import { ServiceError, type ServiceContext } from "./types";

// Customer writes. No `next/*` imports — see ./types.ts.

export type NewCustomer = { id: string; name: string; phone: string };

/**
 * Creates a Customer, typically inline mid-wizard (PRD §7.1 step 2: "search
 * for the Customer, or creates them, if new"). Returns the new row so the
 * caller can select it and move on without a page round-trip.
 *
 * All three fields are required here even though `address` is nullable in
 * the schema — that nullability exists only for a handful of test customers
 * predating the field. Address is what lets a Completed item actually get
 * shipped, so nothing created from now on should be missing it.
 */
export async function createCustomer(
  ctx: ServiceContext,
  input: { name: string; phone: string; address: string },
): Promise<NewCustomer> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();

  if (!name) throw new ServiceError("Name is required.");
  if (!phone) throw new ServiceError("Phone number is required.");
  if (!address) throw new ServiceError("Address is required.");

  const [row] = await ctx.tx
    .insert(customers)
    .values({ organizationId: ctx.organizationId, name, phone, address })
    .returning({ id: customers.id, name: customers.name, phone: customers.phone });

  return row;
}
