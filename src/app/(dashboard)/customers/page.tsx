import { asc, eq } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { customers } from "@/db/schema";
import { CustomersView } from "./customers-view";

export default async function CustomersPage() {
  const rows = await withCurrentOrganization(({ organizationId, tx }) =>
    tx
      .select({ id: customers.id, name: customers.name, phone: customers.phone, address: customers.address })
      .from(customers)
      .where(eq(customers.organizationId, organizationId))
      .orderBy(asc(customers.name)),
  );

  return <CustomersView customers={rows} />;
}
