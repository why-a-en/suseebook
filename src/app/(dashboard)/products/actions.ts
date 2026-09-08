"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { withCurrentOrganization } from "@/lib/tenancy";
import {
  products,
  productImages,
  modifiers,
  modifierOptions,
  productModifierOptions,
} from "@/db/schema";
import { getUploadUrl, buildImageKey } from "@/lib/storage";

/**
 * Hands the browser a short-lived URL it can PUT an image to directly
 * (src/lib/storage.ts) — called from the client image-upload widget before
 * the main product form is submitted, not as a form action itself.
 */
export async function getProductImageUploadUrlAction(filename: string, contentType: string) {
  const user = await requireUser();
  const key = buildImageKey(user.organizationId, "product", filename);
  return getUploadUrl(key, contentType);
}

/**
 * Creates the product, its images (already uploaded to R2 by the time this
 * runs — see getProductImageUploadUrlAction), and — visibly on the same
 * form, not a separate step — an optional first Modifier with its Options.
 * Attaching more Modifiers or picking from existing ones still happens on
 * the product's own page after this (docs/PRD.md §6.1); this covers the
 * common single-modifier case without leaving the creation form at all.
 */
export async function createProductAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;
  const price = String(formData.get("price") ?? "").trim() || null;
  const imageUrls = formData.getAll("imageUrls").map(String).filter(Boolean);
  const modifierName = String(formData.get("modifierName") ?? "").trim();
  const modifierOptionValues = String(formData.get("modifierOptions") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!name || !description) {
    throw new Error("Name and description are required.");
  }

  const productId = await withCurrentOrganization(async ({ organizationId, userId, tx }) => {
    const [product] = await tx
      .insert(products)
      .values({ organizationId, name, description, sourceUrl, price, createdBy: userId })
      .returning({ id: products.id });

    if (imageUrls.length > 0) {
      await tx.insert(productImages).values(
        imageUrls.map((url, index) => ({
          organizationId,
          productId: product.id,
          url,
          sortOrder: index,
        })),
      );
    }

    if (modifierName && modifierOptionValues.length > 0) {
      const [modifier] = await tx
        .insert(modifiers)
        .values({ organizationId, name: modifierName })
        .returning({ id: modifiers.id });

      const insertedOptions = await tx
        .insert(modifierOptions)
        .values(
          modifierOptionValues.map((value, index) => ({
            organizationId,
            modifierId: modifier.id,
            value,
            sortOrder: index,
          })),
        )
        .returning({ id: modifierOptions.id });

      await tx.insert(productModifierOptions).values(
        insertedOptions.map((option) => ({
          organizationId,
          productId: product.id,
          modifierOptionId: option.id,
        })),
      );
    }

    return product.id;
  });

  revalidatePath("/products");
  redirect(`/products/${productId}`);
}

/**
 * The same insert as `createProductAction`, for the one caller that can't
 * use it: the order wizard's inline "new product" sub-step.
 *
 * Two things make the form action above unusable mid-wizard. It ends in a
 * `redirect` to the new product's page, which would throw away a cart the
 * wizard is holding in client state and never wrote anywhere; and it takes
 * FormData, whereas the wizard needs the created row back so it can drop
 * the product straight into the list and let the agent add it to the order
 * without a round-trip. Same relationship `createCustomerAction` has to the
 * customer sheet — one action, both surfaces.
 *
 * Carries the same optional first Modifier as the full form — someone
 * capturing a product mid-order is recording exactly what the customer
 * asked for, and "the red one" is part of that. Still no images: an upload
 * widget inside a wizard sub-step on a phone is a lot of screen for
 * something nobody is waiting on, and photos are catalog curation for the
 * product's own page. The created Modifier (if any) comes back in the
 * shape the wizard's picker renders, so its options are pickable the
 * instant the product lands.
 */
export async function createProductInlineAction(input: {
  name: string;
  description: string;
  price?: string;
  sourceUrl?: string;
  modifierName?: string;
  modifierOptions?: string[];
}): Promise<{
  id: string;
  name: string;
  price: string | null;
  sourceUrl: string | null;
  modifierGroups: { id: string; name: string; options: { id: string; value: string }[] }[];
}> {
  const name = input.name.trim();
  const description = input.description.trim();
  const price = input.price?.trim() || null;
  const sourceUrl = input.sourceUrl?.trim() || null;
  const modifierName = input.modifierName?.trim() ?? "";
  const modifierOptionValues = (input.modifierOptions ?? [])
    .map((v) => v.trim())
    .filter(Boolean);

  if (!name) throw new Error("Name is required.");
  if (!description) throw new Error("Description is required.");

  const product = await withCurrentOrganization(async ({ organizationId, userId, tx }) => {
    const [row] = await tx
      .insert(products)
      .values({ organizationId, name, description, sourceUrl, price, createdBy: userId })
      .returning({ id: products.id, name: products.name, price: products.price, sourceUrl: products.sourceUrl });

    const modifierGroups: { id: string; name: string; options: { id: string; value: string }[] }[] = [];
    if (modifierName && modifierOptionValues.length > 0) {
      const [modifier] = await tx
        .insert(modifiers)
        .values({ organizationId, name: modifierName })
        .returning({ id: modifiers.id });

      const insertedOptions = await tx
        .insert(modifierOptions)
        .values(
          modifierOptionValues.map((value, index) => ({
            organizationId,
            modifierId: modifier.id,
            value,
            sortOrder: index,
          })),
        )
        .returning({ id: modifierOptions.id, value: modifierOptions.value });

      await tx.insert(productModifierOptions).values(
        insertedOptions.map((option) => ({
          organizationId,
          productId: row.id,
          modifierOptionId: option.id,
        })),
      );

      modifierGroups.push({ id: modifier.id, name: modifierName, options: insertedOptions });
    }

    return { ...row, modifierGroups };
  });

  revalidatePath("/products");
  return product;
}

export async function setProductStatusAction(productId: string, status: "active" | "archived") {
  await withCurrentOrganization(async ({ organizationId, tx }) => {
    await tx
      .update(products)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)));
  });
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
}

/**
 * Creates a brand-new Modifier (e.g. "Color") with its initial Options
 * (comma-separated, e.g. "Black, White, Red") and immediately attaches all
 * of them to `productId` — for adding a *second* (or later) Modifier from
 * the product's own page, after creation.
 */
export async function createModifierAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  const name = String(formData.get("modifierName") ?? "").trim();
  const optionsRaw = String(formData.get("options") ?? "");
  const optionValues = optionsRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!productId || !name || optionValues.length === 0) {
    throw new Error("Modifier name and at least one option are required.");
  }

  await withCurrentOrganization(async ({ organizationId, tx }) => {
    const [modifier] = await tx
      .insert(modifiers)
      .values({ organizationId, name })
      .returning({ id: modifiers.id });

    const insertedOptions = await tx
      .insert(modifierOptions)
      .values(
        optionValues.map((value, index) => ({
          organizationId,
          modifierId: modifier.id,
          value,
          sortOrder: index,
        })),
      )
      .returning({ id: modifierOptions.id });

    await tx.insert(productModifierOptions).values(
      insertedOptions.map((option) => ({
        organizationId,
        productId,
        modifierOptionId: option.id,
      })),
    );
  });

  revalidatePath(`/products/${productId}`);
}

/** Attaches a subset of an *existing* Modifier's Options to a product. */
export async function attachModifierOptionsAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  const modifierOptionIds = formData.getAll("modifierOptionIds").map(String);

  if (!productId || modifierOptionIds.length === 0) return;

  await withCurrentOrganization(async ({ organizationId, tx }) => {
    await tx
      .insert(productModifierOptions)
      .values(
        modifierOptionIds.map((modifierOptionId) => ({
          organizationId,
          productId,
          modifierOptionId,
        })),
      )
      .onConflictDoNothing();
  });

  revalidatePath(`/products/${productId}`);
}

export async function detachModifierOptionAction(productId: string, modifierOptionId: string) {
  await withCurrentOrganization(async ({ organizationId, tx }) => {
    await tx
      .delete(productModifierOptions)
      .where(
        and(
          eq(productModifierOptions.organizationId, organizationId),
          eq(productModifierOptions.productId, productId),
          eq(productModifierOptions.modifierOptionId, modifierOptionId),
        ),
      );
  });
  revalidatePath(`/products/${productId}`);
}
