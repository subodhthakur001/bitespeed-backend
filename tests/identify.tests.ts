import request from "supertest";
import { app } from "../src/index";
import { prisma } from "../src/prisma";

describe("/identify API", () => {
  beforeAll(async () => {
    // reset DB before tests
    await prisma.contact.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a new primary contact on first request", async () => {
    const res = await request(app)
      .post("/identify")
      .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" })
      .expect(200);

    expect(res.body.contact.primaryContatctId).toBeDefined();
    expect(res.body.contact.emails).toContain("lorraine@hillvalley.edu");
    expect(res.body.contact.phoneNumbers).toContain("123456");
    expect(res.body.contact.secondaryContactIds).toHaveLength(0);
  });

  it("creates a secondary when new email but same phone", async () => {
    const res = await request(app)
      .post("/identify")
      .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" })
      .expect(200);

    expect(res.body.contact.emails).toEqual(
      expect.arrayContaining(["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"])
    );
    expect(res.body.contact.phoneNumbers).toEqual(["123456"]);
    expect(res.body.contact.secondaryContactIds.length).toBe(1);
  });

  it("returns the same merged record when queried by phone only", async () => {
    const res = await request(app)
      .post("/identify")
      .send({ phoneNumber: "123456" })
      .expect(200);

    expect(res.body.contact.emails).toEqual(
      expect.arrayContaining(["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"])
    );
  });

  it("creates a completely new primary for unique email and phone", async () => {
    const res = await request(app)
      .post("/identify")
      .send({ email: "doc@fluxcapacitor.com", phoneNumber: "555000" })
      .expect(200);

    expect(res.body.contact.primaryContatctId).not.toBeNull();
    expect(res.body.contact.emails).toContain("doc@fluxcapacitor.com");
    expect(res.body.contact.secondaryContactIds).toHaveLength(0);
  });
});
