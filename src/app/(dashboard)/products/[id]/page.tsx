import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import {
  products,
  productImages,
  modifiers,
  modifierOptions,
  productModifierOptions,
} from "@/db/schema";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Thumb } from "@/components/ui/thumb";
import {
  attachModifierOptionsAction,
  createModifierAction,
  detachModifierOptionAction,
  setProductStatusAction,
} from "../actions";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await withCurrentOrganization(async ({ organizationId, tx }) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
      .limit(1);
    if (!product) return null;

    const images = await tx
      .select({ id: productImages.id, url: productImages.url })
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder));

    // Every modifier in the org, each with its options and whether that
    // option is already attached to this product — enough to render both
    // "currently attached" and "available to add" in one query.
    const rows = await tx
      .select({
        modifierId: modifiers.id,
        modifierName: modifiers.name,
        optionId: modifierOptions.id,
        optionValue: modifierOptions.value,
        attached: productModifierOptions.id,
      })
      .from(modifiers)
      .innerJoin(modifierOptions, eq(modifierOptions.modifierId, modifiers.id))
      .leftJoin(
        productModifierOptions,
        and(
          eq(productModifierOptions.modifierOptionId, modifierOptions.id),
          eq(productModifierOptions.productId, id),
        ),
      )
      .where(eq(modifiers.organizationId, organizationId))
      .orderBy(asc(modifiers.name), asc(modifierOptions.sortOrder));

    const modifierMap = new Map<
      string,
      { name: string; attached: { id: string; value: string }[]; available: { id: string; value: string }[] }
    >();
    for (const row of rows) {
      if (!modifierMap.has(row.modifierId)) {
        modifierMap.set(row.modifierId, { name: row.modifierName, attached: [], available: [] });
      }
      const entry = modifierMap.get(row.modifierId)!;
      (row.attached ? entry.attached : entry.available).push({
        id: row.optionId,
        value: row.optionValue,
      });
    }

    return { product, images, modifierGroups: Array.from(modifierMap.entries()) };
  });

  if (!data) notFound();
  const { product, images, modifierGroups } = data;

  return (
    <Screen>
      <TopBar
        title={product.name}
        backHref="/products"
        right={
          <form action={setProductStatusAction.bind(null, product.id, product.status === "active" ? "archived" : "active")}>
            <Button type="submit" variant="ghost" size="sm">
              {product.status === "active" ? "Archive" : "Unarchive"}
            </Button>
          </form>
        }
      />
      <ScrollBody>
        <div className="grid gap-4 px-5 py-4">
          <div className="flex items-center gap-2">
            {product.status === "archived" ? <Badge tone="quiet">Archived</Badge> : <Badge tone="accent">Active</Badge>}
            {product.price ? <span className="font-ui text-body-strong text-text-strong">{Number(product.price).toLocaleString()} MMK</span> : null}
          </div>

          {images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((image) => (
                <Thumb key={image.id} src={image.url} size={80} />
              ))}
            </div>
          ) : (
            <Thumb size={80} label="no photo" />
          )}

          <p className="font-ui text-body text-text-body">{product.description}</p>

          {product.sourceUrl && (
            <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="font-ui text-small-strong">
              View listing
            </a>
          )}

          <section className="grid gap-3">
            <span className="font-mono text-label tracking-label uppercase text-text-faint">Modifiers</span>

            {modifierGroups.length === 0 && <p className="font-ui text-small text-text-muted">No modifiers in your catalog yet.</p>}

            {modifierGroups.map(([modifierId, group]) => (
              <div key={modifierId} className="grid gap-2 rounded-md border border-line-hairline p-3">
                <p className="font-ui text-body-strong text-text-strong">{group.name}</p>

                {group.attached.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {group.attached.map((option) => (
                      <form key={option.id} action={detachModifierOptionAction.bind(null, product.id, option.id)}>
                        <button
                          type="submit"
                          title="Remove"
                          className="cursor-pointer rounded-full border-none bg-surface-raised px-2.5 py-1 font-ui text-small text-text-strong"
                        >
                          {option.value} ✕
                        </button>
                      </form>
                    ))}
                  </div>
                )}

                {group.available.length > 0 && (
                  <form action={attachModifierOptionsAction} className="grid gap-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {group.available.map((option) => (
                        <CheckboxField key={option.id} name="modifierOptionIds" value={option.id}>
                          {option.value}
                        </CheckboxField>
                      ))}
                    </div>
                    <Button type="submit" variant="ghost" size="sm">
                      Add selected
                    </Button>
                  </form>
                )}
              </div>
            ))}

            <details className="rounded-md border border-line-hairline p-3">
              <summary className="cursor-pointer font-ui text-small-strong text-text-strong">+ New modifier</summary>
              <form action={createModifierAction} className="mt-3 grid gap-4">
                <input type="hidden" name="productId" value={product.id} />
                <Field label="Name" required hint="What varies — size, colour, material">
                  <Input name="modifierName" icon="tag" autoComplete="off" placeholder="Colour" />
                </Field>
                <Field label="Options" required hint="Comma-separated">
                  <Input name="options" icon="list" autoComplete="off" placeholder="Black, White, Red" />
                </Field>
                <Button full type="submit" icon="check">
                  Create and attach
                </Button>
              </form>
            </details>
          </section>
        </div>
      </ScrollBody>
    </Screen>
  );
}
