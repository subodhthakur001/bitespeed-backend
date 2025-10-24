import express, { Request, Response } from "express";
import { prisma } from "../prisma";
import { Contact } from "@prisma/client";

const router = express.Router();

/** Helper: unique + drop nulls with a type guard -> string[] */
const uniqueNonNull = (arr: Array<string | null>): string[] =>
  Array.from(new Set(arr.filter((v): v is string => v !== null)));

/** Helper: build an OR array without inserting undefined/null comparisons */
const buildWhereOrForSingleLookup = (email?: string, phoneNumber?: string) => {
  const OR: Array<Record<string, unknown>> = [];
  if (typeof email === "string") OR.push({ email });
  if (typeof phoneNumber === "string") OR.push({ phoneNumber });
  // If neither provided (shouldn’t happen due to earlier check), return a clause that matches nothing.
  return OR.length > 0 ? OR : [{ id: -1 }]; // impossible id to avoid accidental broad match
};

router.post("/", async (req: Request, res: Response) => {
  try {
    // NOTE: explicitly type request body to keep TS strict happy
    const { email, phoneNumber } = req.body as {
      email?: string | null;
      phoneNumber?: string | null;
    };

    if ((!email || email === "") && (!phoneNumber || phoneNumber === "")) {
      return res
        .status(400)
        .json({ error: "Email or phoneNumber required" });
    }

    /**
     * STEP 1: Find existing contacts by either incoming email or phone.
     * Build OR dynamically to avoid querying email=null or phoneNumber=null.
     */
    const existingContacts: Contact[] = await prisma.contact.findMany({
      where: {
        OR: buildWhereOrForSingleLookup(
          email ?? undefined,
          phoneNumber ?? undefined
        ),
      },
    });

    /**
     * STEP 2: If none exist, create a new PRIMARY and return
     * IMPORTANT: Prisma columns are nullable -> pass null (not undefined) to satisfy exactOptionalPropertyTypes
     */
    if (existingContacts.length === 0) {
      const created = await prisma.contact.create({
        data: {
          email: email ?? null,
          phoneNumber: phoneNumber ?? null,
          linkPrecedence: "primary",
        },
      });

      return res.status(200).json({
        contact: {
          primaryContatctId: created.id,
          emails: uniqueNonNull([created.email]),
          phoneNumbers: uniqueNonNull([created.phoneNumber]),
          secondaryContactIds: [],
        },
      });
    }

    /**
     * STEP 3: Expand the “component” of linked contacts that share any known email/phone.
     * Start with emails/phones from what we just found, fetch everyone who matches either set.
     */
    const seedsEmails = uniqueNonNull(existingContacts.map((c) => c.email));
    const seedsPhones = uniqueNonNull(
      existingContacts.map((c) => c.phoneNumber)
    );

    // Build OR only for non-empty sets to avoid `{in: []}`.
    const orForExpansion: Array<Record<string, unknown>> = [];
    if (seedsEmails.length > 0) orForExpansion.push({ email: { in: seedsEmails } });
    if (seedsPhones.length > 0) orForExpansion.push({ phoneNumber: { in: seedsPhones } });

    // If somehow both are empty (very unlikely), fall back to the single-lookup OR
    const whereExpansion =
      orForExpansion.length > 0
        ? { OR: orForExpansion }
        : { OR: buildWhereOrForSingleLookup(email ?? undefined, phoneNumber ?? undefined) };

    const allLinkedContacts: Contact[] = await prisma.contact.findMany({
      where: whereExpansion,
    });

    if (allLinkedContacts.length === 0) {
      // Defensive (shouldn’t happen): treat as new primary
      const created = await prisma.contact.create({
        data: {
          email: email ?? null,
          phoneNumber: phoneNumber ?? null,
          linkPrecedence: "primary",
        },
      });

      return res.status(200).json({
        contact: {
          primaryContatctId: created.id,
          emails: uniqueNonNull([created.email]),
          phoneNumbers: uniqueNonNull([created.phoneNumber]),
          secondaryContactIds: [],
        },
      });
    }

    /**
     * STEP 4: Determine PRIMARY = the oldest by createdAt among all related records.
     * If multiple already marked "primary", the oldest stays primary; others must be downgraded.
     */
    const primary: Contact = allLinkedContacts.reduce(
      (oldest: Contact, curr: Contact) => {
        // Oldest by createdAt wins (regardless of current linkPrecedence value)
        return curr.createdAt < oldest.createdAt ? curr : oldest;
      },
      allLinkedContacts[0]!
    );

    /**
     * STEP 5: Ensure every non-primary is SECONDARY pointing to primary.
     * (Only update those that aren’t already correct.)
     */
    const toDowngrade = allLinkedContacts.filter(
      (c) => c.id !== primary.id && (c.linkPrecedence !== "secondary" || c.linkedId !== primary.id)
    );

    if (toDowngrade.length > 0) {
      await Promise.all(
        toDowngrade.map((c) =>
          prisma.contact.update({
            where: { id: c.id },
            data: {
              linkPrecedence: "secondary",
              linkedId: primary.id,
            },
          })
        )
      );
    }

    /**
     * STEP 6: If the incoming payload introduces *new* info (either a new email or a new phone
     * not present in this component), create a SECONDARY linked to primary.
     */
    const hasSameTuple = allLinkedContacts.some(
      (c) =>
        (email ?? null) === c.email &&
        (phoneNumber ?? null) === c.phoneNumber
    );

    const alreadyHasEmail =
      email ? allLinkedContacts.some((c) => c.email === email) : true;
    const alreadyHasPhone =
      phoneNumber ? allLinkedContacts.some((c) => c.phoneNumber === phoneNumber) : true;

    const introducesNewInfo =
      !hasSameTuple && ((email && !alreadyHasEmail) || (phoneNumber && !alreadyHasPhone));

    if (introducesNewInfo) {
      await prisma.contact.create({
        data: {
          email: email ?? null,
          phoneNumber: phoneNumber ?? null,
          linkPrecedence: "secondary",
          linkedId: primary.id,
        },
      });
    }

    /**
     * STEP 7: Re-fetch the final snapshot: primary + everything linked to it
     */
    const finalContacts: Contact[] = await prisma.contact.findMany({
      where: {
        OR: [{ id: primary.id }, { linkedId: primary.id }],
      },
    });

    const finalEmails = uniqueNonNull(finalContacts.map((c) => c.email));
    const finalPhones = uniqueNonNull(finalContacts.map((c) => c.phoneNumber));
    const secondaryIds = finalContacts
      .filter((c) => c.linkPrecedence === "secondary")
      .map((c) => c.id);

    /**
     * STEP 8: Format and return
     * NOTE: spec says first entries should be primary’s values if present
     */
    const prependIfPresent = (arr: string[], val: string | null): string[] => {
      if (!val) return arr;
      // Put primary's value first if present; keep unique order
      return [val, ...arr.filter((x) => x !== val)];
    };

    const orderedEmails = prependIfPresent(finalEmails, primary.email);
    const orderedPhones = prependIfPresent(finalPhones, primary.phoneNumber);

    return res.status(200).json({
      contact: {
        primaryContatctId: primary.id,
        emails: orderedEmails,
        phoneNumbers: orderedPhones,
        secondaryContactIds: secondaryIds,
      },
    });
  } catch (err) {
    console.error("❌ /identify error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
