"use client";

import { useState, useTransition } from "react";
import { Screen, ScrollBody, Toolbar } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { CustomerRow } from "@/components/ui/customer-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetBody } from "@/components/ui/sheet";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCustomerAction } from "@/app/(dashboard)/orders/actions";

export interface CustomerRowData {
  id: string;
  name: string;
  phone: string;
  address: string | null;
}

/** Same search-or-create shape as the order wizard's Customer step
 *  (new-order-wizard.tsx) — this page is the other place that needs it,
 *  now that Customers has its own home (see (dashboard)/home/page.tsx). New
 *  customers are appended to local state on success rather than waiting on
 *  a round-trip: createCustomerAction already revalidates this route, so a
 *  future navigation back here reflects the server list too. */
export function CustomersView({ customers }: { customers: CustomerRowData[] }) {
  const [rows, setRows] = useState(customers);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const query = q.toLowerCase();
  const filtered = rows.filter((c) => (c.name + c.phone).toLowerCase().includes(query));

  function reset() {
    setName("");
    setPhone("");
    setAddress("");
    setError(null);
  }

  function handleClose() {
    reset();
    setOpen(false);
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createCustomerAction({ name, phone, address });
        setRows((prev) => [...prev, { id: created.id, name: created.name, phone: created.phone, address }].sort((a, b) => a.name.localeCompare(b.name)));
        handleClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't create that customer.");
      }
    });
  }

  return (
    <Screen>
      <TopBar
        backHref="/home"
        title="Customers"
        eyebrow={`${rows.length} customer${rows.length === 1 ? "" : "s"}`}
        right={<IconButton icon="user-plus" label="Add customer" variant="solid" onClick={() => setOpen(true)} />}
      />
      <Toolbar>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Name or phone" />
      </Toolbar>
      <ScrollBody>
        {filtered.length === 0 ? (
          <EmptyState
            icon="users"
            title={q ? "No match." : "No customers yet."}
            body={q ? "Nobody by that name or number." : "Add the first one to get started."}
          />
        ) : (
          filtered.map((c) => <CustomerRow key={c.id} name={c.name} phone={c.phone} address={c.address} />)
        )}
      </ScrollBody>

      <Sheet open={open} onOpenChange={(next) => !next && handleClose()}>
        <SheetContent>
          <SheetHeader title="New customer" />
          <SheetBody>
            <div className="grid gap-4 py-2">
              <Field label="Name" required>
                <Input icon="user" autoComplete="name" placeholder="Aung Aung" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone" required>
                <Input icon="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="09 …" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Address" required hint="Needed to ship the parcel once it arrives.">
                <Textarea icon="map-pin" rows={2} autoComplete="street-address" placeholder="House, street, township, city" value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              <Button full icon="user-plus" disabled={!name || !phone || !address || isPending} onClick={handleCreate}>
                {isPending ? "Creating…" : "Create customer"}
              </Button>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ErrorDialog open={!!error} message={error} onOk={() => setError(null)} />
    </Screen>
  );
}
