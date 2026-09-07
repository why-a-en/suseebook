"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Screen, ScrollBody, Foot, Toolbar } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchField } from "@/components/ui/search-field";
import { OptionChips } from "@/components/ui/option-chips";
import { QtyDial } from "@/components/ui/qty-dial";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { CustomerRow } from "@/components/ui/customer-row";
import { ProductRow } from "@/components/ui/product-row";
import { OrderItemRow } from "@/components/ui/order-item-row";
import { SectionHeader } from "@/components/ui/section-header";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Icon } from "@/components/icon";
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
 *  that's a sub-state of Items, not its own step. */
function StepIndicator({ step }: { step: Step }) {
  const activeIndex = STEPS.findIndex((s) => s.key === step);
  return (
    <Toolbar className="pt-[18px] pb-3">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <div key={s.key} className={done || active ? "flex items-center" : "flex items-center"} style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
              <span
                className={
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] " +
                  (done || active ? "border border-transparent bg-accent text-accent-ink" : "border border-line-strong text-text-faint")
                }
              >
                {done ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className={"ml-1.5 whitespace-nowrap font-ui text-small-strong " + (active ? "text-text-strong" : "text-text-faint")}>{s.label}</span>
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
 *  holds the actual commit actions ("Place order" / "Save as draft") behind
 *  one more confirmation once there's something to confirm. "Save draft"
 *  writes the order as-is (placed_at stays null) and returns to the list —
 *  it'll show up there to resume later (tap it — see orders-view.tsx linking
 *  to `/orders/new?draft=<id>`, which reopens this straight at the Items
 *  step via the `resume` prop, same as before Review existed). "Place order"
 *  is the same action with `place: true`, which also redirects to the order
 *  detail page. */
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
   *  and land the agent where they can immediately use it. Here that means
   *  opening the new product's picker straight away — it has no modifiers,
   *  so "Add item" is live on the spot and the only remaining decision is
   *  quantity. */
  function handleCreateProduct() {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createProductInlineAction({
          name: newProductName,
          description: newProductDescription,
          price: newProductPrice,
          sourceUrl: newProductSourceUrl,
        });
        const product: WizardProduct = { ...created, modifierGroups: [] };
        setExtraProducts((prev) => [product, ...prev]);
        setAddingProduct(false);
        setNewProductName("");
        setNewProductDescription("");
        setNewProductPrice("");
        setNewProductSourceUrl("");
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
    const modifierOptionIds = picking.modifierGroups.map((g) => {
      const value = selections[g.id];
      return g.options.find((o) => o.value === value)!.id;
    });
    setCart((prev) => [
      ...prev,
      {
        key: `${picking.id}-${Date.now()}`,
        productId: picking.id,
        productName: picking.name,
        selection: picking.modifierGroups.map((g) => selections[g.id]).filter(Boolean),
        modifierOptionIds,
        quantity: qty,
      },
    ]);
    setPicking(null);
    setSelections({});
    setQty(1);
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
  // Default (Customer step, and Items below): back leaves the wizard route
  // entirely, back to the Orders list — there's nothing "behind" Customer to
  // step to within the wizard itself. Items also has its own inline "Change
  // customer" link for stepping back a wizard step without leaving the route.
  let onBack: (() => void) | undefined = () => router.push("/orders");
  let body;
  let footer;

  if (step === "customer") {
    body = addingCustomer ? (
      <div className="grid gap-4 px-5">
        <Field label="Name" required>
          <Input icon="user" autoComplete="name" placeholder="Aung Aung" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
        </Field>
        <Field label="Phone" required>
          <Input icon="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="09 …" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
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
                  setNewCustomerName(customerQuery);
                }}
              />
            }
          />
        </div>
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
            body={`Nobody called “${customerQ}”. Add them with the + above.`}
          />
        ) : null}
        {hiddenMatchCount > 0 ? (
          <p className="px-5 font-ui text-small text-text-faint">
            Showing {customers.length} of {customerTotal} — search by name or phone to find someone else.
          </p>
        ) : null}
      </div>
    );
    // Only the create sub-step has a footer. "+ New customer" used to live
    // here as a full-width pinned button, because it had gone unreachable
    // below a long customer list — but that list is capped at BROWSE_CAP
    // now, and the button has moved to the top of the body beside the search
    // it belongs to, which is above the fold rather than merely pinned. With
    // it gone there is no second action on this step (picking a customer
    // advances), so the footer goes too and the list gets the height back.
    // Back is still a real, equally-weighted button in the sub-step, not the
    // small inline text link it once was.
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
    ) : null;
  } else if (step === "items") {
    title = customer?.name ?? "Items";
    eyebrow = "Items";
    body = addingProduct ? (
      // Same shape as the Customer step's inline create: the step's body
      // becomes the form and its footer becomes Back / Create, rather than a
      // Sheet stacked over a wizard that already owns the whole screen.
      <div className="grid gap-4 px-5">
        <Field label="Name" required>
          <Input icon="package" autoComplete="off" placeholder="Denim jacket" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
        </Field>
        <Field label="Description" required>
          <Textarea icon="align-left" rows={2} placeholder="Colour, fabric, fit — anything the customer should know" value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} />
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
        <p className="font-ui text-small text-text-faint">
          Photos and modifiers can be added on the product&rsquo;s own page later — neither is needed to put it on this order.
        </p>
      </div>
    ) : (
      <div className="grid gap-3">
        {/* The order so far — its items, then its notes. Notes belongs with
            these and not at the foot of the step: it annotates the order,
            and sitting last it ended up directly under whatever the product
            search produced, so against an empty result it read as a note
            about the product that couldn't be found. It also only appears
            once something is on the order, since there's nothing to annotate
            before that and a lone notes box above an untouched catalog is
            the first thing you'd have to scroll past. */}
        {totalItemCount ? (
          <>
            <div className="min-w-0">
              <SectionHeader right={`${totalItemCount} items`}>On this order</SectionHeader>
              {existingItems.map((line, i) => (
                <OrderItemRow key={`existing-${i}`} product={line.productName} selection={line.selection} qty={line.quantity} status="Pending" />
              ))}
              {cart.map((line) => (
                <OrderItemRow key={line.key} product={line.productName} selection={line.selection} qty={line.quantity} status="Pending" />
              ))}
            </div>
            <Field className="px-5" label="Notes" hint="Optional — anything the Supplier should know">
              <Textarea icon="align-left" rows={2} placeholder="Anything the Supplier should know" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </>
        ) : null}

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
                  setNewProductName(productQuery);
                }}
              />
            }
          />
        </div>
        {allProducts.length && visibleProducts.length === 0 ? (
          <EmptyState
            icon="package"
            title="No match."
            body={`Nothing in the catalog called “${productQuery}”. Add it with the + above.`}
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
                    <Button full icon="plus" disabled={!allSelected} onClick={commitItem} className="rounded-full shadow-raised">
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
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Button variant="secondary" icon="arrow-left" onClick={() => (resume ? router.push("/orders") : setStep("customer"))}>
            Previous
          </Button>
          <Button full iconAfter="chevron-right" disabled={!totalItemCount} onClick={() => setStep("review")} className="flex-1 rounded-full shadow-raised">
            Review order
          </Button>
        </div>
        <Button full variant="secondary" icon="clock" disabled={isPending} onClick={() => handleSave(false)}>
          Save as draft
        </Button>
      </div>
    );
  } else {
    // Review — purely a client-side summary of what's already in state
    // (existingItems + cart + notes); nothing here has been saved yet.
    title = customer?.name ?? "Review";
    eyebrow = "Review";
    onBack = () => setStep("items");
    body = (
      <div className="grid gap-3">
        <div className="min-w-0">
          <p className="px-5 font-ui text-small text-text-muted">Check everything, then place the order.</p>
          <SectionHeader>Customer</SectionHeader>
          {customer ? <CustomerRow name={customer.name} phone={customer.phone} address={customer.address} /> : null}
        </div>

        <div className="min-w-0">
          <SectionHeader right={`${totalItemCount} items`}>Items</SectionHeader>
          {existingItems.map((line, i) => (
            <OrderItemRow key={`existing-${i}`} product={line.productName} selection={line.selection} qty={line.quantity} status="Pending" />
          ))}
          {cart.map((line) => (
            <OrderItemRow key={line.key} product={line.productName} selection={line.selection} qty={line.quantity} status="Pending" />
          ))}
          <div className="flex items-baseline justify-between px-5 pt-3">
            <span className="font-ui text-body-strong text-text-strong">Total</span>
            <span className="font-ui text-body-strong text-text-strong [font-variant-numeric:tabular-nums]">
              {priceTotal.toLocaleString()} MMK{hasUnpricedItem ? "+" : ""}
            </span>
          </div>
          {hasUnpricedItem ? (
            <p className="px-5 pt-0.5 font-ui text-small text-text-faint">One or more items don&rsquo;t have a set price yet — total is a minimum.</p>
          ) : null}
        </div>

        {/* Read-only recap, not a control — `group` keeps the label a
            labelled region instead of a `htmlFor` pointing at an id that no
            element on this step carries. Absent entirely when there are no
            notes: Review is a list of what's on the order, and a labelled
            row saying "No notes added." is a line of chrome reporting the
            absence of something optional. Trimmed, because saveOrderAction
            stores whitespace-only notes as null — this would otherwise show
            an empty row for something that won't be saved at all. */}
        {notes.trim() ? (
          <Field className="px-5" label="Notes" group>
            <p className="font-ui text-body text-text-body">{notes}</p>
          </Field>
        ) : null}
      </div>
    );
    footer = (
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Button variant="secondary" icon="arrow-left" onClick={() => setStep("items")}>
            Previous
          </Button>
          <Button full icon="check" disabled={!totalItemCount || isPending} onClick={() => handleSave(true)} className="flex-1 rounded-full shadow-raised">
            {isPending ? "Saving…" : "Place order"}
          </Button>
        </div>
        <Button full variant="secondary" icon="clock" disabled={isPending} onClick={() => handleSave(false)}>
          Save as draft
        </Button>
      </div>
    );
  }

  return (
    <Screen>
      <TopBar title={title} eyebrow={eyebrow} onBack={onBack} />
      <StepIndicator step={step} />
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
    </Screen>
  );
}
