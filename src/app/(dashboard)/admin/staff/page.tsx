import { listPendingInvitations, requireAdmin } from "@/lib/auth";
import { withCurrentOrganization } from "@/lib/tenancy";
import { listStaff } from "@/services/staff";
import { listStores } from "@/services/stores";
import { StaffView } from "./staff-view";

// Admin-only. requireAdmin() redirects a Support Agent or Supplier who
// reaches this URL directly — the route is guarded, not just unlinked.
export default async function StaffPage() {
  const user = await requireAdmin();
  const [{ staff, stores }, pendingInvitations] = await Promise.all([
    withCurrentOrganization(async (ctx) => ({
      staff: await listStaff(ctx),
      stores: await listStores(ctx),
    })),
    listPendingInvitations(),
  ]);

  return (
    <StaffView
      staff={staff}
      stores={stores}
      currentUserId={user.id}
      pendingInvitations={pendingInvitations}
    />
  );
}
