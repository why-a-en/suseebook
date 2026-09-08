"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Screen, ScrollBody, Foot, Toolbar } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import { SearchField } from "@/components/ui/search-field";
import { OptionChips } from "@/components/ui/option-chips";
import { QtyDial } from "@/components/ui/qty-dial";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { CustomerRow } from "@/components/ui/customer-row";
import { ProductRow } from "@/components/ui/product-row";
import { SectionHeader } from "@/components/ui/section-header";
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter } from "@/components/ui/sheet";
import { ErrorDialog } from "@/components/ui/error-dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/icon";
import { armNavigationGuard, disarmNavigationGuard } from "@/lib/navigation-guard";
import { cn } from "@/lib/utils";
import { createProductInlineAction } from "@/app/(dashboard)/products/actions";
import { createCustomerAction, saveOrderAction, searchCustomersAction } from "./actions";

export interface WizardCustomer {
  id: string;
  name: string;
  phone: string;
  address: string | null;
}

export interface WizardModifierGroup {
  id: string;
  name: string;
  options: { id: string; value: string }[];
}

export interface WizardProduct {
  id: string;
  name: string;
  price: string | null;
  sourceUrl: string | null;
  modifierGroups: WizardModifierGroup[];
}

/** A saved-but-not-placed Order — resuming it reopens the wizard straight
 *  at the Items step with its customer and whatever was already added. */
export interface DraftResume {
  orderId: string;
  customer: WizardCustomer;
  notes: string;
  existingItems: { productName: string; price: string | null; selection: string[]; quantity: number }[];
}

interface CartLine {
  key: string;
  productId: string;
  productName: string;
  selection: string[];
  modifierOptionIds: string[];
  quantity: number;
}

type Step = "customer" | "items" | "review";

function formatPrice(price: string | null): string | undefined {
  if (!price) return undefined;
  return `${Number(price).toLocaleString()} MMK`;
}

/** The typed query, echoed back in a "no match" line — capped so a long one
 *  doesn't turn the empty state into a wall of text. */
function clipQuery(q: string): string {
  return q.length > 24 ? `${q.slice(0, 24).trimEnd()}…` : q;
}

/** One line of the order — the same shape in the panel and on Review.
 *  Name truncates; the ×qty stays put beside it; the extended price (or
 *  nothing, when the order carries no prices at all) sits at the right;
 *  the options run comma-separated underneath. */
function OrderLine({
  name,
  options,
  quantity,
  amount,
  muted = false,
}: {
  name: string;
  options: string[];
  quantity: number;
  amount: string | null;
  muted?: boolean;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn("min-w-0 truncate font-ui text-body-strong", muted ? "text-text-muted" : "text-text-strong")}>
            {name}
          </span>
          <span className="shrink-0 font-ui text-small text-text-faint [font-variant-numeric:tabular-nums]">×{quantity}</span>
        </span>
        {amount != null ? (
          <span
            className={cn(
              "shrink-0 font-ui text-small-strong [font-variant-numeric:tabular-nums]",
              muted ? "text-text-faint" : "text-text-strong",
            )}
          >
            {amount}
          </span>
        ) : null}
      </div>
      {options.length ? (
        <div className="mt-0.5 truncate font-ui text-small text-text-muted">{options.join(", ")}</div>
      ) : null}
    </>
  );
}

/** How many products the picker lists before you type.
 *
 *  Products, unlike customers, arrive complete — the route fetches every
 *  active one, so filtering them in the browser is a correct answer over the
 *  whole catalog rather than over a slice of it. This cap is therefore a
 *  display choice (don't open on a long scroll) and not a limit on what
 *  search can reach. Customers are capped on the server instead, and searched
 *  there — see searchCustomersAction. */
const PRODUCT_BROWSE_CAP = 8;

const STEPS = [
  { key: "customer", label: "Customer" },
  { key: "items", label: "Items" },
  { key: "review", label: "Review" },
] as const;

/** Persistent progress readout across all three steps — the eyebrow text
 *  alone ("Step 2 of 3") is easy to miss above a title that's changed to the
 *  customer's name by then. Making progress this visible is also what makes
 *  "Save as draft" legible as a concept: it's plainly a pause partway
 *  through a multi-step form, not a separate lesser kind of order. Stays put
 *  (doesn't add a fourth step) while configuring one product's modifiers —
 *  that's a sub-state of Items, not its own step.
 *
 *  It's also the primary way to move between steps: any pip whose step is
 *  reachable (see `stepReachable`) is a button that jumps straight there,
 *  carrying all wizard state with it. The current step and any step still
 *  gated behind an unmet prerequisite are inert. */
function StepIndicator({
  step,
  reachable,
  onJump,
}: {
  step: Step;
  reachable: (target: Step) => boolean;
  onJump: (target: Step) => void;
}) {
  const activeIndex = STEPS.findIndex((s) => s.key === step);
  return (
    <Toolbar className="pt-[18px] pb-3">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const canJump = !active && reachable(s.key);
          const pip = (
            <>
              <span
                className={
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] " +
                  (done || active ? "border border-transparent bg-accent text-accent-ink" : "border border-line-strong text-text-faint")
                }
              >
                {done ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span
                className={
                  "ml-1.5 whitespace-nowrap font-ui text-small-strong " +
                  (active ? "text-text-strong" : canJump ? "text-text-body" : "text-text-faint")
                }
              >
                {s.label}
              </span>
            </>
          );
          return (
            <div key={s.key} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
              {canJump ? (
                <button
                  type="button"
                  onClick={() => onJump(s.key)}
                  aria-label={`Go to ${s.label}`}
                  className="flex items-center rounded-full transition-transform duration-fast ease-standard active:scale-95"
                >
                  {pip}
                </button>
              ) : (
                <span className="flex items-center">{pip}</span>
              )}
              {i < STEPS.length - 1 ? <span className={"mx-2.5 h-px flex-1 " + (done ? "bg-accent" : "bg-line-hairline")} /> : null}
            </div>
          );
        })}
      </div>
    </Toolbar>
  );
}

/** Order creation, as a real multi-step form — Customer, then Items, then
 *  Review — matching docs/PRD.md §7.1: search-or-create the Customer, then
 *  repeatably add products with their modifier selection and quantity,
 *  attach notes to the order as a whole, confirm, save. A dedicated route
 *  (`/orders/new`, this component's only mount point — see its page.tsx)
 *  rather than a Sheet dialog: a 3-step form with its own
 *  product-configuration sub-step is substantial enough to want the full
 *  screen and a real URL, not a modal stacked over the Orders list. Review
 *  is purely a client-side summary — nothing new to fetch or save, it just
 *  holds "Place order" (`saveOrderAction` with `place: true`, which redirects
 *  to the order detail page).
 *
 *  Nothing is written until then. Leaving the wizard with unsaved work —
 *  the top-bar back, the tab bar (guarded via src/lib/navigation-guard), a
 *  refresh — prompts to "Save as draft" first. That's the only way a draft
 *  is created now: an interrupted order, not a deliberate lesser one. A
 *  draft is the order as-is with `placed_at` null; it shows in the Orders
 *  list and reopens here via `/orders/new?draft=<id>` (the `resume` prop),
 *  landing straight on Items. */
export function NewOrderWizard({
  customers,
  customerTotal,
  products,
  resume,
}: {
  /** The browse page shown before anything is typed — not the whole table.
   *  Searching goes to the server (see the effect below). */
  customers: WizardCustomer[];
  customerTotal: number;
  products: WizardProduct[];
  resume?: DraftResume | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(resume ? "items" : "customer");
  const [customerQuery, setCustomerQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [customer, setCustomer] = useState<WizardCustomer | null>(resume?.customer ?? null);

  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductSourceUrl, setNewProductSourceUrl] = useState("");
  // One optional Modifier, same as /products/new — enough to capture "the
  // red one in size M" while it's being asked for. A second Modifier is
  // catalog work for the product's own page.
  const [newProductModifierName, setNewProductModifierName] = useState("");
  const [newProductModifierOptions, setNewProductModifierOptions] = useState<string[]>([]);
  // Products created inline during this wizard run. The `products` prop is a
  // server snapshot taken when the route rendered; a product created here
  // has to join the list the Items step is filtering over without a
  // navigation, or the thing you just made isn't there to add.
  const [extraProducts, setExtraProducts] = useState<WizardProduct[]>([]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState(resume?.notes ?? "");
  const [picking, setPicking] = useState<WizardProduct | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  // The order so far lives in a panel behind the running-total line in the
  // footer, so the catalog keeps the whole screen no matter how long the
  // order gets. `editingLine` is the line key whose stepper is open.
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  // Where a blocked navigation was trying to go — non-null means the
  // "leave without saving?" dialog is open. "" stands for "just close the
  // dialog" cases that shouldn't be reachable.
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Customer search runs on the server. It used to filter the `customers`
  // prop, which was the first 200 rows — so the 201st customer could not be
  // found from the one screen whose whole job is finding a customer, and the
  // picker showed no rows rather than admitting it had only looked at part of
  // the table. The obvious next move for anyone hitting that is to create the
  // customer again, which is how you end up with duplicate records.
  //
  // Results are stored with the query they answer, rather than as a bare list
  // plus a separate "searching" flag. That makes staleness a comparison
  // instead of a state to keep in sync: whether a search is outstanding is
  // just "the stored query isn't the current one", which can't drift, and
  // the effect never has to setState on the way in.
  const [customerSearch, setCustomerSearch] = useState<{ query: string; rows: WizardCustomer[] } | null>(null);
  const customerQ = customerQuery.trim();

  useEffect(() => {
    // Empty query needs no request — the browse page below covers it.
    if (!customerQ) return;
    // `cancelled` does two jobs: the timeout is cleared while typing
    // continues (the debounce), and a response that lands after a newer
    // query was issued is dropped — otherwise a slow "yan" arriving after a
    // fast "yang" would show the wrong list under the right query.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const rows = await searchCustomersAction(customerQ);
        if (!cancelled) setCustomerSearch({ query: customerQ, rows });
      } catch {
        if (!cancelled) setCustomerSearch({ query: customerQ, rows: [] });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerQ]);

  const browsingCustomers = customerQ === "";
  // While a new query is in flight the previous rows stay put rather than
  // blanking — same call the Order log makes, and it keeps the list from
  // flickering empty between keystrokes.
  const visibleMatches = browsingCustomers ? customers : (customerSearch?.rows ?? []);
  const customerSearching = !browsingCustomers && customerSearch?.query !== customerQ;
  // What the browse page is holding back, so the list can say so rather than
  // looking like the whole customer table.
  const hiddenMatchCount = browsingCustomers ? Math.max(0, customerTotal - customers.length) : 0;
  // Same shape as the customer search above: filter client-side over the
  // already-fetched catalog, cap the unfiltered browse view so a large
  // catalog doesn't turn "add a product" into a long scroll before search
  // was even tried.
  // A Server Action re-renders the current route as part of its response, so
  // `products` usually comes back already containing anything created here —
  // but not always (the action can resolve before that payload is applied),
  // and holding it locally is what makes the new product appear instantly.
  // Keeping both means deduping: without this the list rendered the same id
  // twice and React warned about duplicate keys.
  const allProducts = [...extraProducts.filter((e) => !products.some((p) => p.id === e.id)), ...products];
  const matchingProducts = allProducts.filter((p) => p.name.toLowerCase().includes(productQuery.toLowerCase()));
  const visibleProducts = productQuery ? matchingProducts : matchingProducts.slice(0, PRODUCT_BROWSE_CAP);
  const hiddenProductCount = matchingProducts.length - visibleProducts.length;
  const existingItems = resume?.existingItems ?? [];
  const totalItemCount = existingItems.length + cart.length;
  // Cart lines only carry a productId, existing (resumed) lines carry their
  // own price straight from the DB — either way, a null price (product has
  // none set) can't be assumed to be 0, so it's tracked separately rather
  // than silently under-totaling.
  let priceTotal = 0;
  let hasUnpricedItem = false;
  for (const line of existingItems) {
    if (line.price == null) hasUnpricedItem = true;
    else priceTotal += Number(line.price) * line.quantity;
  }
  for (const line of cart) {
    const price = allProducts.find((p) => p.id === line.productId)?.price;
    if (price == null) hasUnpricedItem = true;
    else priceTotal += Number(price) * line.quantity;
  }
  // Money is common but not guaranteed at order time (Price is optional on a
  // product). With nothing priced there's no figure worth showing — the
  // docket drops the amount column and just carries line counts.
  const showAmounts = priceTotal > 0;
  const totalText = `${priceTotal.toLocaleString()} MMK${hasUnpricedItem ? "+" : ""}`;

  // Is there work that would be lost by leaving? A fresh order is dirty once
  // a customer is picked or anything is typed; a resumed draft only once
  // it's been added to or its notes edited beyond what was saved. Never
  // while a save is already in flight.
  const dirty =
    !isPending &&
    (cart.length > 0 ||
      (resume
        ? notes.trim() !== (resume.notes ?? "").trim()
        : customer !== null || notes.trim().length > 0));
  // A draft still needs a customer to save against.
  const canSaveDraft = customer !== null;

  function handleCreateCustomer() {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createCustomerAction({ name: newCustomerName, phone: newCustomerPhone, address: newCustomerAddress });
        setCustomer({ id: created.id, name: created.name, phone: created.phone, address: newCustomerAddress });
        setStep("items");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't create that customer.");
      }
    });
  }

  /** Mirrors handleCreateCustomer: create, drop the row into local state,
   *  and land the agent where they can immediately use it — the new
   *  product's picker opens straight away. If a Modifier was entered the
   *  picker opens on its options (and "Add item" waits for a choice); if
   *  not, quantity is the only remaining decision and "Add item" is live. */
  function handleCreateProduct() {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createProductInlineAction({
          name: newProductName,
          description: newProductDescription,
          price: newProductPrice,
          sourceUrl: newProductSourceUrl,
          modifierName: newProductModifierName,
          modifierOptions: newProductModifierOptions,
        });
        const product: WizardProduct = created;
        setExtraProducts((prev) => [product, ...prev]);
        setAddingProduct(false);
        setNewProductName("");
        setNewProductDescription("");
        setNewProductPrice("");
        setNewProductSourceUrl("");
        setNewProductModifierName("");
        setNewProductModifierOptions([]);
        // Narrow the list to the new product rather than clearing the
        // query. Cleared, it lands wherever the refreshed catalog sorts it —
        // for anything past the third product that is below the fold, with
        // its picker open somewhere the agent can't see. Filtered, the thing
        // just created is the only row, at the top, already expanded.
        setProductQuery(created.name);
        setPicking(product);
        setSelections({});
        setQty(1);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't create that product.");
      }
    });
  }

  // Expands/collapses inline under the tapped ProductRow (an accordion, not
  // a separate "configure item" screen — that used to fully replace the
  // Items view for one product, which made adding a second item a confusing
  // trip back to something that looked like square one). Tapping the same
  // product again closes it; tapping a different one swaps which is open,
  // since configuring two at once isn't a real use case.
  function togglePicker(product: WizardProduct) {
    if (picking?.id === product.id) {
      setPicking(null);
      return;
    }
    setPicking(product);
    setSelections({});
    setQty(1);
  }

  function commitItem() {
    if (!picking) return;
    const product = picking;
    const modifierOptionIds = product.modifierGroups.map((g) => {
      const value = selections[g.id];
      return g.options.find((o) => o.value === value)!.id;
    });
    // Same product, same options = the same line — a second "Add item" bumps
    // its quantity rather than stacking a duplicate row. Options compared as
    // a set so order can't matter.
    const lineKey = (productId: string, ids: string[]) => `${productId}::${[...ids].sort().join(",")}`;
    const thisKey = lineKey(product.id, modifierOptionIds);
    setCart((prev) => {
      const existing = prev.findIndex((line) => lineKey(line.productId, line.modifierOptionIds) === thisKey);
      if (existing !== -1) {
        return prev.map((line, i) => (i === existing ? { ...line, quantity: line.quantity + qty } : line));
      }
      return [
        ...prev,
        {
          key: `${product.id}-${Date.now()}`,
          productId: product.id,
          productName: product.name,
          selection: product.modifierGroups.map((g) => selections[g.id]).filter(Boolean),
          modifierOptionIds,
          quantity: qty,
        },
      ];
    });
    setPicking(null);
    setSelections({});
    setQty(1);
  }

  function setOrderLineQty(key: string, quantity: number) {
    setCart((prev) => prev.map((line) => (line.key === key ? { ...line, quantity } : line)));
  }

  function removeOrderLine(key: string) {
    const next = cart.filter((line) => line.key !== key);
    setCart(next);
    setEditingLine(null);
    // Nothing left to show — a resumed draft's own items keep it relevant.
    if (next.length === 0 && existingItems.length === 0) setOrderPanelOpen(false);
  }

  /** A line's extended price, formatted, or "—" when the product has no set
   *  price. No currency suffix — the docket carries it once, on the total. */
  function lineAmount(productPrice: string | null, quantity: number): string {
    return productPrice == null ? "—" : (Number(productPrice) * quantity).toLocaleString();
  }

  // Every path out of the wizard that isn't "Place order" goes through here:
  // the top-bar back, the Items step's Previous when resuming, and (via the
  // guard armed below) the tab bar. If there's unsaved work it opens the
  // dialog instead of navigating; otherwise it just goes.
  function leaveWizard(destination: string) {
    if (dirty) setLeaveTo(destination);
    else router.push(destination);
  }

  // While there's unsaved work, arm the shared guard (catches the tab bar's
  // Links) and the browser's own unload prompt (catches refresh / close /
  // hard navigation, where only the native dialog is possible).
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (destination: string | null) => setLeaveTo(destination ?? "/orders");
    armNavigationGuard(onLeave);
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      disarmNavigationGuard(onLeave);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  function discardAndLeave() {
    const destination = leaveTo ?? "/orders";
    setLeaveTo(null);
    // router.push doesn't route through the Link guard, so this isn't
    // re-caught; the guard is torn down by the effect cleanup on unmount.
    router.push(destination);
  }

  function saveDraftAndLeave() {
    setLeaveTo(null);
    handleSave(false); // writes the draft, then routes to /orders itself
  }

  // Free movement between steps, driven by the progress indicator. Only the
  // two data-entry sub-steps are torn down; every field of wizard state —
  // the chosen customer, the cart, the notes, a half-typed new customer or
  // product — is left exactly as it was, so a jump is never a reset.
  function jumpToStep(target: Step) {
    setAddingCustomer(false);
    setAddingProduct(false);
    setPicking(null);
    setStep(target);
  }

  // Which pips the indicator turns into buttons. A completed step is always
  // revisitable; a step ahead unlocks only once its prerequisite exists —
  // Items needs a customer, Review needs a customer and at least one line.
  // A resumed draft keeps its customer fixed (same rule as the Items step's
  // "Previous" button), so that pip stays inert.
  function stepReachable(target: Step): boolean {
    if (target === "customer") return !resume;
    if (target === "items") return customer !== null;
    return customer !== null && totalItemCount > 0;
  }

  function handleSave(place: boolean) {
    if (!customer) return;
    if (place && totalItemCount === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveOrderAction({
          orderId: resume?.orderId,
          customerId: customer.id,
          notes,
          items: cart.map((line) => ({ productId: line.productId, modifierOptionIds: line.modifierOptionIds, quantity: line.quantity })),
          place,
        });
        // saveOrderAction redirects when place=true (throws internally, so
        // this line only runs for a draft save) — the revalidated Orders
        // list already reflects it, just head back there.
        void result;
        router.push("/orders");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save the order.");
      }
    });
  }

  let title = "New order";
  let eyebrow = "Customer";
  // The top-bar back leaves the wizard for the Orders list, from every step —
  // stepping backwards is the footer's "Previous" and the progress indicator.
  // The two data-entry sub-steps override this to close themselves instead.
  let onBack: (() => void) | undefined = () => leaveWizard("/orders");
  let body;
  let footer;

  if (step === "customer") {
    body = addingCustomer ? (
      <div className="grid gap-4 px-5">
        <Field label="Name" required>
          <Input icon="user" autoComplete="name" placeholder="Aung Aung" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
        </Field>
        <Field label="Phone" required>
          <Input icon="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="09 987 654 321" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
        </Field>
        <Field label="Address" required hint="Needed to ship the parcel once it arrives.">
          <Textarea icon="map-pin" rows={2} autoComplete="street-address" placeholder="House, street, township, city" value={newCustomerAddress} onChange={(e) => setNewCustomerAddress(e.target.value)} />
        </Field>
      </div>
    ) : (
      <div className="grid gap-3">
        {/* Same search + create pairing as the Items step below. */}
        <div className="px-5">
          <SearchField
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            onClear={() => setCustomerQuery("")}
            placeholder="Name or phone"
            trailing={
              <IconButton
                icon="user-plus"
                label="New customer"
                variant="solid"
                onClick={() => {
                  setAddingCustomer(true);
                  // Seed the name from the search, but never over a name
                  // already typed — you may be coming back to this form.
                  setNewCustomerName((prev) => prev || customerQuery);
                }}
              />
            }
          />
        </div>
        {/* When you've stepped back to this screen the chosen customer is
            still set — surface it, checked, so "my selection is gone" is
            never a question. Pinned only when it isn't already one of the
            rows below (a large table, or a narrowed search). */}
        {customer && !visibleMatches.some((c) => c.id === customer.id) ? (
          <div className="min-w-0">
            <SectionHeader>Selected</SectionHeader>
            <CustomerRow
              name={customer.name}
              phone={customer.phone}
              address={customer.address}
              onClick={() => setStep("items")}
              right={<Icon name="check" size={16} color="var(--color-accent-text)" />}
            />
          </div>
        ) : null}
        <div className={customerSearching ? "opacity-55 transition-opacity duration-fast ease-standard" : "transition-opacity duration-fast ease-standard"}>
          {visibleMatches.map((c) => (
            <CustomerRow
              key={c.id}
              name={c.name}
              phone={c.phone}
              address={c.address}
              onClick={() => {
                setCustomer(c);
                setStep("items");
              }}
              right={c.id === customer?.id ? <Icon name="check" size={16} color="var(--color-accent-text)" /> : undefined}
            />
          ))}
        </div>
        {/* An empty search result is now a real answer — the server looked at
            every customer — so it says so, and points at the + rather than
            leaving the obvious next move as "create a duplicate". Held back
            until the request settles, or every pause mid-word would flash
            "no match" at someone who is still typing. */}
        {!browsingCustomers && !customerSearching && visibleMatches.length === 0 ? (
          <EmptyState
            icon="users"
            title="No match."
            body={`Nobody called “${clipQuery(customerQ)}”. Add them with the + above.`}
          />
        ) : null}
        {hiddenMatchCount > 0 ? (
          <p className="px-5 font-ui text-small text-text-faint">
            Showing {customers.length} of {customerTotal} — search by name or phone to find someone else.
          </p>
        ) : null}
      </div>
    );
    // "+ New customer" used to live here as a full-width pinned button,
    // because it had gone unreachable below a long customer list — but that
    // list is capped at BROWSE_CAP now, and the button has moved to the top
    // of the body beside the search it belongs to. Back in the sub-step is
    // still a real, equally-weighted button, not the small inline text link
    // it once was.
    //
    // The footer carries "Continue to items" only once a customer is
    // chosen — which, thanks to the pick-to-advance shortcut, means you got
    // here by stepping back. It's the forward half of the pair the other
    // steps already have, and its presence is the signal that the earlier
    // choice survived the trip back.
    //
    // In the create sub-step the top-bar back arrow mirrors the footer's
    // Back: it steps back to the customer search, not out of the wizard.
    if (addingCustomer) onBack = () => setAddingCustomer(false);
    footer = addingCustomer ? (
      <div className="flex gap-2">
        <Button variant="secondary" icon="arrow-left" onClick={() => setAddingCustomer(false)}>
          Back
        </Button>
        <Button
          full
          icon="user-plus"
          disabled={!newCustomerName || !newCustomerPhone || !newCustomerAddress || isPending}
          onClick={handleCreateCustomer}
          className="flex-1 rounded-full shadow-raised"
        >
          {isPending ? "Creating…" : "Create customer"}
        </Button>
      </div>
    ) : customer ? (
      <Button full iconAfter="chevron-right" onClick={() => setStep("items")} className="rounded-full shadow-raised">
        Continue to items
      </Button>
    ) : null;
  } else if (step === "items") {
    title = customer?.name ?? "Items";
    eyebrow = "Items";
    // Product sub-step closes itself; otherwise the default (leave the
    // wizard) stands.
    if (addingProduct) onBack = () => setAddingProduct(false);
    body = addingProduct ? (
      // Same shape as the Customer step's inline create: the step's body
      // becomes the form and its footer becomes Back / Create, rather than a
      // Sheet stacked over a wizard that already owns the whole screen.
      <div className="grid gap-4 px-5">
        <Field label="Name" required>
          <Input icon="package" autoComplete="off" placeholder="Denim jacket" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
        </Field>
        <Field label="Description" required>
          <Textarea rows={3} placeholder="Colour, fabric, fit — anything the customer should know" value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} />
        </Field>
        <Field label="Source URL" hint="Link to the exact Lazada/TikTok Shop listing.">
          <Input
            type="url"
            icon="link"
            placeholder="https://…"
            value={newProductSourceUrl}
            onChange={(e) => setNewProductSourceUrl(e.target.value)}
          />
        </Field>
        <Field label="Price" hint="Optional, MMK">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            icon="coins"
            suffix="MMK"
            placeholder="15000"
            value={newProductPrice}
            onChange={(e) => setNewProductPrice(e.target.value)}
          />
        </Field>

        {/* One optional Modifier, same layout as /products/new. Filled in,
            it's created and attached with the product, and the picker that
            opens next lands straight on its options. */}
        <div className="grid gap-4 rounded-md border border-line-hairline p-3">
          <div className="grid gap-1">
            <span className="font-mono text-label tracking-label uppercase text-text-faint">Modifier (optional)</span>
            <p className="font-ui text-small text-text-faint">
              One thing that varies, and its choices — you&rsquo;ll pick one for this line next.
            </p>
          </div>
          <Field label="Name" hint="What varies — size, colour, material">
            <Input
              icon="tag"
              autoComplete="off"
              placeholder="Colour"
              value={newProductModifierName}
              onChange={(e) => setNewProductModifierName(e.target.value)}
            />
          </Field>
          <Field label="Options" hint="Press Enter after each">
            <TagInput
              icon="list"
              placeholder="Black, White, Red"
              value={newProductModifierOptions}
              onChange={setNewProductModifierOptions}
            />
          </Field>
        </div>

        <p className="font-ui text-small text-text-faint">
          Photos, and any further modifiers, can be added on the product&rsquo;s own page later — neither is needed to put it on this order.
        </p>
      </div>
    ) : (
      <div className="grid gap-3">
        {/* Just the catalog. What's already on the order lives in a sheet
            behind the pinned bar in the footer, so adding the 12th item
            doesn't mean scrolling past the first 11 — and Notes lives on
            Review. This step is only "find and add products". */}

        {/* Search and "new product" are one row: the moment you find out a
            product isn't in the catalog is the moment you want to add it,
            and that moment happens here, not in a button somewhere else on
            the page. Same pairing the Orders log uses for its date filter. */}
        <div className="px-5">
          <SearchField
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            onClear={() => setProductQuery("")}
            placeholder="Search products"
            trailing={
              <IconButton
                icon="plus"
                label="New product"
                variant="solid"
                onClick={() => {
                  setAddingProduct(true);
                  setNewProductName((prev) => prev || productQuery);
                }}
              />
            }
          />
        </div>
        {allProducts.length && visibleProducts.length === 0 ? (
          <EmptyState
            icon="package"
            title="No match."
            body={`Nothing in the catalog called “${clipQuery(productQuery.trim())}”. Add it with the + above.`}
          />
        ) : null}
        {allProducts.length ? (
          visibleProducts.map((p) => {
            const expanded = picking?.id === p.id;
            const allSelected = p.modifierGroups.every((g) => selections[g.id]);
            return (
              <div key={p.id}>
                <ProductRow
                  name={p.name}
                  meta={formatPrice(p.price)}
                  sourceUrl={p.sourceUrl}
                  onClick={() => togglePicker(p)}
                  right={<Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} color="var(--color-text-faint)" />}
                />
                {expanded ? (
                  <div className="grid gap-3 border-b border-line-hairline bg-surface-sunken px-5 py-3">
                    {p.modifierGroups.map((group) => (
                      <Field key={group.id} label={group.name} required group>
                        <OptionChips
                          options={group.options.map((o) => o.value)}
                          value={selections[group.id]}
                          onChange={(v) => setSelections((prev) => ({ ...prev, [group.id]: v as string }))}
                        />
                      </Field>
                    ))}
                    <Field label="Quantity" group>
                      <QtyDial value={qty} onChange={setQty} min={1} />
                    </Field>
                    <Button full icon="notebook-pen" disabled={!allSelected} onClick={commitItem} className="rounded-full shadow-raised">
                      Add item
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <EmptyState icon="package" title="No products yet." body="Add the first one with the + above." />
        )}
        {hiddenProductCount > 0 ? (
          <p className="px-5 font-ui text-small text-text-faint">
            Showing {PRODUCT_BROWSE_CAP} of {matchingProducts.length} — search by name to find another.
          </p>
        ) : null}
      </div>
    );
    footer = addingProduct ? (
      <div className="flex gap-2">
        <Button variant="secondary" icon="arrow-left" onClick={() => setAddingProduct(false)}>
          Back
        </Button>
        <Button
          full
          icon="plus"
          disabled={!newProductName || !newProductDescription || isPending}
          onClick={handleCreateProduct}
          className="flex-1 rounded-full shadow-raised"
        >
          {isPending ? "Creating…" : "Create product"}
        </Button>
      </div>
    ) : (
      <div className="grid gap-3">
        {totalItemCount ? (
          // A plain tappable row — surface, label, summary, chevron — so it
          // reads as "open the order", not as a caption. Opens the panel.
          <button
            type="button"
            onClick={() => setOrderPanelOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-line-hairline bg-surface-raised px-4 py-3 text-left transition-transform duration-fast ease-standard active:scale-[0.985]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Icon name="clipboard-list" size={16} className="shrink-0 text-text-muted" />
              <span className="truncate font-ui text-body-strong text-text-strong">
                {totalItemCount === 1 ? "Order item" : "Order items"}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-ui text-small text-text-muted [font-variant-numeric:tabular-nums]">{totalItemCount}</span>
              {showAmounts ? (
                <span className="font-ui text-small-strong text-text-strong [font-variant-numeric:tabular-nums]">
                  {totalText}
                </span>
              ) : null}
              <Icon name="chevron-right" size={16} className="text-text-faint" />
            </span>
          </button>
        ) : null}
        <div className="flex gap-2">
          <Button variant="secondary" icon="arrow-left" onClick={() => (resume ? leaveWizard("/orders") : setStep("customer"))}>
            Previous
          </Button>
          <Button full iconAfter="chevron-right" disabled={!totalItemCount} onClick={() => setStep("review")} className="flex-1 rounded-full shadow-raised">
            Review order
          </Button>
        </div>
      </div>
    );
  } else {
    // Review — purely a client-side summary of what's already in state
    // (existingItems + cart + notes); nothing here has been saved yet.
    title = customer?.name ?? "Review";
    eyebrow = "Review";
    // Top-bar back leaves the wizard (default); "Previous" in the footer is
    // the way back to Items.
    body = (
      <div className="grid gap-3">
        <div className="min-w-0">
          <p className="px-5 font-ui text-small text-text-muted">Check everything, then place the order.</p>
          <SectionHeader>Customer</SectionHeader>
          {customer ? <CustomerRow name={customer.name} phone={customer.phone} address={customer.address} /> : null}
        </div>

        <div className="min-w-0">
          <SectionHeader right={`${totalItemCount} item${totalItemCount === 1 ? "" : "s"}`}>Order</SectionHeader>
          {[
            ...existingItems.map((line, i) => ({
              key: `existing-${i}`,
              name: line.productName,
              selection: line.selection,
              quantity: line.quantity,
              amount: showAmounts ? lineAmount(line.price, line.quantity) : null,
            })),
            ...cart.map((line) => ({
              key: line.key,
              name: line.productName,
              selection: line.selection,
              quantity: line.quantity,
              amount: showAmounts ? lineAmount(allProducts.find((p) => p.id === line.productId)?.price ?? null, line.quantity) : null,
            })),
          ].map((line) => (
            <div key={line.key} className="border-b border-line-hairline px-5 py-3 last:border-b-0">
              <OrderLine name={line.name} options={line.selection} quantity={line.quantity} amount={line.amount} />
            </div>
          ))}
          <div className="flex items-baseline justify-between px-5 pt-3">
            <span className="font-mono text-label tracking-label uppercase text-text-faint">Total</span>
            <span
              className={cn(
                "font-ui text-body-strong [font-variant-numeric:tabular-nums]",
                showAmounts ? "text-text-strong" : "text-text-faint",
              )}
            >
              {showAmounts ? totalText : "Not priced yet"}
            </span>
          </div>
        </div>

        {/* Notes is entered here, not on Items — it annotates the whole
            order, and the last look before placing it is the natural moment
            to add "call before delivery". saveOrderAction stores a
            whitespace-only value as null, so leaving it empty costs nothing. */}
        <Field className="px-5" label="Notes" hint="Optional — anything the Supplier should know">
          <Textarea rows={3} placeholder="Anything the Supplier should know" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    );
    footer = (
      <div className="flex gap-2">
        <Button variant="secondary" icon="arrow-left" onClick={() => setStep("items")}>
          Previous
        </Button>
        <Button full icon="check" disabled={!totalItemCount || isPending} onClick={() => handleSave(true)} className="flex-1 rounded-full shadow-raised">
          {isPending ? "Saving…" : "Place order"}
        </Button>
      </div>
    );
  }

  return (
    <Screen>
      <TopBar title={title} eyebrow={eyebrow} onBack={onBack} />
      <StepIndicator step={step} reachable={stepReachable} onJump={jumpToStep} />
      <ScrollBody>
        {/* No gutter here — Screen's contract is that the body doesn't get
            one, because full-bleed rows carry their own px-5 and it is part
            of the row rhythm. A gutter here double-padded every list in the
            wizard, so its hairlines stopped 20px short of both screen edges
            and the lists read as boxed-in panels rather than the lists they
            are on every other screen. Non-row content takes `px-5` itself. */}
        <div className="pt-3 pb-12">{body}</div>
      </ScrollBody>
      {footer ? <Foot padded>{footer}</Foot> : null}
      <ErrorDialog open={!!error} message={error} onOk={() => setError(null)} />

      <AlertDialog open={leaveTo !== null} onOpenChange={(open) => !open && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without placing the order?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {canSaveDraft
                ? "Nothing here is saved yet. Save it as a draft to finish later, or leave and lose it."
                : "Nothing here is saved yet, and there's no customer to save a draft against — leaving now loses it."}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="grid gap-2">
            {canSaveDraft ? (
              <Button full icon="clock" disabled={isPending} onClick={saveDraftAndLeave}>
                Save as draft
              </Button>
            ) : null}
            <Button full variant="danger" onClick={discardAndLeave}>
              Discard and leave
            </Button>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={orderPanelOpen}
        onOpenChange={(open) => {
          setOrderPanelOpen(open);
          if (!open) setEditingLine(null);
        }}
      >
        <SheetContent>
          <SheetHeader title="Order" eyebrow={customer ? `For ${customer.name}` : undefined} />
          <SheetBody className="pt-1">
            {/* Lines already saved on the draft — shown for the whole
                picture, greyed, no editing (that needs a server round-trip). */}
            {existingItems.map((line, i) => (
              <div key={`existing-${i}`} className="border-b border-line-hairline py-3 last:border-b-0">
                <OrderLine
                  name={line.productName}
                  options={line.selection}
                  quantity={line.quantity}
                  amount={showAmounts ? lineAmount(line.price, line.quantity) : null}
                  muted
                />
              </div>
            ))}

            {cart.map((line) => {
              const editing = editingLine === line.key;
              const unitPrice = allProducts.find((p) => p.id === line.productId)?.price ?? null;
              return (
                <div key={line.key} className="border-b border-line-hairline last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setEditingLine(editing ? null : line.key)}
                    aria-expanded={editing}
                    className="block w-full rounded-sm py-3 text-left transition-colors duration-fast ease-standard active:bg-surface-hover"
                  >
                    <OrderLine
                      name={line.productName}
                      options={line.selection}
                      quantity={line.quantity}
                      amount={showAmounts ? lineAmount(unitPrice, line.quantity) : null}
                    />
                  </button>
                  {editing ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-sm bg-surface-sunken px-3 py-2.5">
                      <QtyDial value={line.quantity} onChange={(n) => setOrderLineQty(line.key, n)} min={1} />
                      <Button variant="danger" size="sm" icon="x" onClick={() => removeOrderLine(line.key)}>
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </SheetBody>
          <SheetFooter className="flex items-baseline justify-between">
            <span className="font-mono text-label tracking-label uppercase text-text-faint">Total</span>
            <span
              className={cn(
                "font-ui text-body-strong [font-variant-numeric:tabular-nums]",
                showAmounts ? "text-text-strong" : "text-text-faint",
              )}
            >
              {showAmounts ? totalText : "Not priced yet"}
            </span>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Screen>
  );
}
