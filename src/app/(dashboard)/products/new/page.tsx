import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ImageUploadField } from "@/components/image-upload-field";
import { createProductAction } from "../actions";

// Everything on one form, visible up front — no separate step to notice or
// miss (see docs/PRD.md §6.1: attaching a Modifier happens "without
// leaving the form"). A second Modifier, or attaching an existing one
// instead of creating new, still happens on the product's own page after
// this — this form covers the common single-modifier case inline.
export default function NewProductPage() {
  return (
    <Screen>
      <TopBar brand title="Add a product" backHref="/products" />
      <ScrollBody>
        <form action={createProductAction} className="grid gap-4 px-5 pt-4 pb-8">
          <Field label="Name" required>
            <Input name="name" icon="package" autoComplete="off" placeholder="Denim jacket" />
          </Field>
          <Field label="Description" required>
            <Textarea name="description" icon="align-left" rows={3} placeholder="Colour, fabric, fit — anything the customer should know" />
          </Field>
          <Field label="Images">
            <ImageUploadField />
          </Field>
          <Field label="Source URL" hint="Link to the exact Lazada/TikTok Shop listing.">
            <Input name="sourceUrl" type="url" icon="link" placeholder="https://…" />
          </Field>
          <Field label="Price" hint="Optional, MMK">
            <Input name="price" type="number" inputMode="decimal" step="0.01" min="0" icon="coins" suffix="MMK" placeholder="15000" />
          </Field>

          <div className="grid gap-4 rounded-md border border-line-hairline p-3">
            <div className="grid gap-1">
              <span className="font-mono text-label tracking-label uppercase text-text-faint">Modifier (optional)</span>
              <p className="font-ui text-small text-text-faint">
                One thing that varies, and the choices for it. The team picks one when adding this product to an order.
              </p>
            </div>
            <Field label="Name" hint="What varies — size, colour, material">
              <Input name="modifierName" icon="tag" autoComplete="off" placeholder="Colour" />
            </Field>
            <Field label="Options" hint="Press Enter after each">
              <TagInput name="modifierOptions" placeholder="Black, White, Red" />
            </Field>
          </div>

          <Button full type="submit" icon="check">
            Save product
          </Button>
        </form>
      </ScrollBody>
    </Screen>
  );
}
