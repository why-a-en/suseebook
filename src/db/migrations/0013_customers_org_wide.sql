ALTER TABLE "customers" DROP CONSTRAINT "customers_store_id_stores_id_fk";
--> statement-breakpoint
DROP INDEX "customers_organization_store_name_idx";--> statement-breakpoint
CREATE INDEX "customers_organization_name_idx" ON "customers" USING btree ("organization_id","name");--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "store_id";