import { requirePlatformUser } from "@/lib/auth";
import { platformMetrics } from "@/services/platform";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { operatorLogoutAction } from "./actions";

// The operator home. A glance at the whole platform, then the two jobs that
// live here: provisioning client Stores, and stepping into one to
// help (impersonation).
export default async function PlatformHome() {
  const user = await requirePlatformUser();
  const m = await platformMetrics();

  const newThisWeek = m.newLast7Days.organizations + m.newLast7Days.users;

  return (
    <Screen>
      <TopBar brand title="Operator" eyebrow={user.email} />
      <ScrollBody>
        <div className="grid grid-cols-2 gap-3 px-5 pt-4">
          <StatTile value={m.organizations.total} label="Stores" />
          <StatTile value={m.users} label="Users" />
        </div>
        <p className="px-5 pt-2 font-ui text-small text-text-faint">
          {m.members.byRole.admin} admin{m.members.byRole.admin === 1 ? "" : "s"} ·{" "}
          {m.members.byRole.support_agent} support · {m.members.byRole.supplier} supplier
          {m.members.byRole.supplier === 1 ? "" : "s"}
          {newThisWeek > 0 && ` · ${newThisWeek} new this week`}
        </p>
        {m.organizations.suspended > 0 && (
          <p className="px-5 pt-1 font-ui text-small text-danger">
            {m.organizations.suspended} Store
            {m.organizations.suspended === 1 ? "" : "s"} suspended
          </p>
        )}

        <SectionHeader>Manage</SectionHeader>
        <Row href="/platform/organizations">
          <Icon name="inbox" size={18} className="shrink-0 text-text-faint" />
          <span className="flex-1">Stores</span>
          <Icon name="chevron-right" size={16} className="shrink-0 text-text-faint" />
        </Row>
        <Row href="/platform/users">
          <Icon name="users" size={18} className="shrink-0 text-text-faint" />
          <span className="flex-1">Users</span>
          <Icon name="chevron-right" size={16} className="shrink-0 text-text-faint" />
        </Row>
        <Row href="/platform/impersonate">
          <Icon name="user" size={18} className="shrink-0 text-text-faint" />
          <span className="flex-1">Impersonate a user</span>
          <Icon name="chevron-right" size={16} className="shrink-0 text-text-faint" />
        </Row>

        <div className="px-5 pt-6 pb-8">
          <form action={operatorLogoutAction}>
            <Button full type="submit" variant="secondary" icon="log-out">
              Sign out
            </Button>
          </form>
        </div>
      </ScrollBody>
    </Screen>
  );
}
