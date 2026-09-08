"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter } from "@/components/ui/sheet";
import { Icon } from "@/components/icon";
import type { Store } from "@/services/stores";
import { addStoreAction, setStoreStatusAction } from "./actions";

export function StoresView({ stores }: { stores: Store[] }) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Store | null>(null);

  return (
    <Screen>
      {/* Reached from Home, not a tab — see CLAUDE.md's "every nested
          screen has a back button". */}
      <TopBar backHref="/home" title="Stores" />
      <ScrollBody>
        <SectionHeader right={`${stores.length}`}>Locations</SectionHeader>

        {stores.map((store) => (
          <Row key={store.id} onClick={() => setSelected(store)}>
            <span className="min-w-0 flex-1 truncate">{store.name}</span>
            <div className="flex shrink-0 items-center gap-2">
              {store.status === "suspended" && (
                <span className="font-ui text-small text-danger">Suspended</span>
              )}
              <Icon name="chevron-right" size={16} className="text-text-faint" />
            </div>
          </Row>
        ))}

        <div className="px-5 pt-5 pb-8">
          <Button full variant="secondary" icon="store" onClick={() => setAdding(true)}>
            Add store
          </Button>
        </div>
      </ScrollBody>

      <AddStoreSheet open={adding} onOpenChange={setAdding} />
      <ManageStoreSheet store={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}

function AddStoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>{open && <AddStoreForm onDone={() => onOpenChange(false)} />}</SheetContent>
    </Sheet>
  );
}

function AddStoreForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(addStoreAction, undefined);

  // Close once the action has come back without an error. From an effect,
  // not during render or in an onClick — see commit history / CLAUDE.md.
  // Nothing to show on success here (unlike Add staff's one-time password),
  // so the list's own revalidation is all that's needed.
  useEffect(() => {
    if (state && !state.error) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction}>
      <SheetHeader title="Add store" />
      <SheetBody className="grid gap-4">
        <Field label="Name" required>
          <Input name="name" autoComplete="off" placeholder="Yangon Downtown" />
        </Field>
        {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      </SheetBody>
      <SheetFooter>
        <Button full type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add store"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function ManageStoreSheet({ store, onClose }: { store: Store | null; onClose: () => void }) {
  const [pending, startTransition] = useTransition();

  return (
    <Sheet open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {store && (
          <>
            <SheetHeader title={store.name} />
            <SheetBody>
              <Button
                full
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setStoreStatusAction(
                      store.id,
                      store.status === "suspended" ? "active" : "suspended",
                    );
                    if (result.error) {
                      toast.error(result.error);
                      return;
                    }
                    onClose();
                  })
                }
              >
                {store.status === "suspended" ? "Restore store" : "Suspend store"}
              </Button>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
