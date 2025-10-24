-- DropIndex
DROP INDEX "public"."Contact_email_key";

-- DropIndex
DROP INDEX "public"."Contact_phoneNumber_key";

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_phoneNumber_idx" ON "Contact"("phoneNumber");
