ALTER TABLE "member_stores" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "member_stores" CASCADE;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "stores" CASCADE;--> statement-breakpoint
-- CASCADE here already drops the order_items/orders/sessions FKs into
-- stores (drizzle-kit generated separate DROP CONSTRAINT statements for
-- those below the table drop; Postgres has already removed them by then,
-- so those statements were re-ordered above this one and folded away).
DROP TABLE "stores" CASCADE;--> statement-breakpoint
DROP INDEX "order_items_org_store_product_status_idx";--> statement-breakpoint
DROP INDEX "order_items_org_store_status_created_idx";--> statement-breakpoint
DROP INDEX "orders_organization_store_created_idx";--> statement-breakpoint
CREATE INDEX "order_items_org_product_status_idx" ON "order_items" USING btree ("organization_id","product_id","status");--> statement-breakpoint
CREATE INDEX "order_items_org_status_created_idx" ON "order_items" USING btree ("organization_id","status","created_at");--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "store_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "store_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "active_store_id";--> statement-breakpoint
DROP TYPE "public"."store_status";