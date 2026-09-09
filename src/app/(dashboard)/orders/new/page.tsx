import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { withCurrentStore } from "@/lib/tenancy";
import { isUuid } from "@/lib/uuid";
import { orders, orderItems, orderItemModifiers, customers, products, modifiers, modifierOptions, productModifierOptions } from "@/db/schema";
import { NewOrderWizard, type WizardProduct, type DraftResume } from "../new-order-wizard";
import { fetchCustomerBrowse } from "../query";

/** The Customer→Items wizard, as its own route (not a Sheet over the Orders
 *  list — see new-order-wizard.tsx's doc comment for why). Fresh order:
 *  `/orders/new`. Resuming a saved draft: `/orders/new?draft=<orderId>` —
 *  orders-view.tsx links straight here instead of holding wizard state
 *  itself. */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const user = await requireUser();
  if (user.role === "supplier") redirect("/orders");

  const { draft: draftId } = await searchParams;
  if (draftId !== undefined && !isUuid(draftId)) notFound();

  const data = await withCurrentStore(async ({ organizationId, storeId, tx }) => {
    const productRows = await tx
      .select({ id: products.id, name: products.name, price: products.price, sourceUrl: products.sourceUrl })
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.status, "active")))
      .orderBy(asc(products.name));

    const activeProductIds = productRows.map((p) => p.id);
    const modifierRows =
      activeProductIds.length === 0
        ? []
        : await tx
            .select({
              productId: productModifierOptions.productId,
              modifierId: modifiers.id,
              modifierName: modifiers.name,
              optionId: modifierOptions.id,
              optionValue: modifierOptions.value,
            })
            .from(productModifierOptions)
            .innerJoin(modifierOptions, eq(modifierOptions.id, productModifierOptions.modifierOptionId))
            .innerJoin(modifiers, eq(modifiers.id, modifierOptions.modifierId))
            .where(inArray(productModifierOptions.productId, activeProductIds))
            .orderBy(asc(modifiers.name), asc(modifierOptions.sortOrder));

    const groupsByProduct = new Map<string, Map<string, { id: string; name: string; options: { id: string; value: string }[] }>>();
    for (const row of modifierRows) {
      const groups = groupsByProduct.get(row.productId) ?? new Map();
      if (!groups.has(row.modifierId)) groups.set(row.modifierId, { id: row.modifierId, name: row.modifierName, options: [] });
      groups.get(row.modifierId)!.options.push({ id: row.optionId, value: row.optionValue });
      groupsByProduct.set(row.productId, groups);
    }

    const wizardProducts: WizardProduct[] = productRows.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      sourceUrl: p.sourceUrl,
      modifierGroups: Array.from(groupsByProduct.get(p.id)?.values() ?? []),
    }));

    if (!draftId) return { wizardProducts, resume: null as DraftResume | null };

    // A draft is an Order with placed_at still null — resuming one that's
    // already been placed, belongs to another org (RLS already scopes the
    // query, so it just comes back empty), or another Store in this org, is
    // a 404, not a silent reset to a fresh wizard.
    const [order] = await tx
      .select({
        id: orders.id,
        customerId: orders.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerAddress: customers.address,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(orders.id, draftId),
          eq(orders.organizationId, organizationId),
          eq(orders.storeId, storeId),
          isNull(orders.placedAt),
        ),
      );
    if (!order) return { wizardProducts, resume: undefined };

    // Only still-pending items come back into the wizard — a line the
    // Supplier has already bought is out of the composer's hands, and a
    // save here reconciles by deleting-and-reinserting the pending set
    // (see saveOrder). Non-pending lines stay on the order untouched and
    // are managed from the order detail page.
    const itemRows = await tx
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        productName: products.name,
        productPrice: products.price,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.status, "pending")));

    const itemIds = itemRows.map((r) => r.id);
    const selectionRows =
      itemIds.length === 0
        ? []
        : await tx
            .select({
              orderItemId: orderItemModifiers.orderItemId,
              modifierOptionId: orderItemModifiers.modifierOptionId,
              value: modifierOptions.value,
            })
            .from(orderItemModifiers)
            .innerJoin(modifierOptions, eq(modifierOptions.id, orderItemModifiers.modifierOptionId))
            .where(inArray(orderItemModifiers.orderItemId, itemIds));
    const selectionsByItem = new Map<string, { values: string[]; optionIds: string[] }>();
    for (const s of selectionRows) {
      const entry = selectionsByItem.get(s.orderItemId) ?? { values: [], optionIds: [] };
      entry.values.push(s.value);
      entry.optionIds.push(s.modifierOptionId);
      selectionsByItem.set(s.orderItemId, entry);
    }

    const resume: DraftResume = {
      orderId: order.id,
      customer: { id: order.customerId, name: order.customerName, phone: order.customerPhone, address: order.customerAddress },
      items: itemRows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        price: r.productPrice,
        selection: selectionsByItem.get(r.id)?.values ?? [],
        modifierOptionIds: selectionsByItem.get(r.id)?.optionIds ?? [],
        quantity: r.quantity,
      })),
    };
    return { wizardProducts, resume };
  });

  if (data.resume === undefined) notFound();

  // Customers are fetched separately, and only a browse page of them: the
  // picker searches in SQL now (searchCustomersAction), so there is no reason
  // to ship a slab of the customer table to the client and no cap that can
  // silently hide someone from search.
  const { rows: browseCustomers, total: customerTotal } = await fetchCustomerBrowse();

  return (
    <NewOrderWizard
      customers={browseCustomers}
      customerTotal={customerTotal}
      products={data.wizardProducts}
      resume={data.resume}
    />
  );
}
