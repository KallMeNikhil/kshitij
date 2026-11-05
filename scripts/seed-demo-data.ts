import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { generateDemoData } from "../src/demo-data/generate";

const EMULATOR_PROJECT_ID = "demo-kshitij";
const EMULATOR_FIRESTORE_HOST = "127.0.0.1:8080";

async function seed() {
  const projectId = process.env.GCLOUD_PROJECT ?? EMULATOR_PROJECT_ID;
  if (!projectId.startsWith("demo-")) {
    throw new Error(
      `Refusing to seed project "${projectId}". This script only targets emulator projects whose id starts with "demo-".`
    );
  }
  process.env.FIRESTORE_EMULATOR_HOST ??= EMULATOR_FIRESTORE_HOST;

  initializeApp({ projectId });
  const db = getFirestore();
  const bundle = generateDemoData();

  const batchWrite = async <T extends { }>(collectionName: string, docs: T[], idField: keyof T) => {
    let batch = db.batch();
    let count = 0;
    for (const doc of docs) {
      const ref = db.collection(collectionName).doc(String(doc[idField]));
      batch.set(ref, doc);
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();
  };

  await batchWrite("sports", bundle.sports, "sportId");
  await batchWrite("competitions", bundle.competitions, "competitionId");
  await batchWrite("participants", bundle.participants, "participantId");
  await batchWrite("teams", bundle.teams, "teamId");
  await batchWrite("fixtures", bundle.fixtures, "fixtureId");
  await batchWrite("matchStates", bundle.matchStates, "fixtureId");

  const announcementsBatch = db.batch();
  bundle.announcements.forEach((a) => {
    const ref = db.collection("announcements").doc();
    announcementsBatch.set(ref, { ...a, createdAt: new Date().toISOString(), createdBy: "seed-script" });
  });
  await announcementsBatch.commit();

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@kshitij.test").toLowerCase();
  const now = new Date().toISOString();
  await db.collection("admins").doc(adminEmail).set({
    email: adminEmail,
    displayName: "Local Super Admin",
    role: "SUPER_ADMIN",
    sportIds: [],
    active: true,
    createdAt: now,
    createdBy: "seed-script",
    updatedAt: now,
    updatedBy: "seed-script",
  });

  console.log(
    `Seeded ${bundle.sports.length} sports, ${bundle.competitions.length} competitions, ${bundle.participants.length} participants, ${bundle.teams.length} teams, ${bundle.fixtures.length} fixtures, ${bundle.matchStates.length} match states into ${projectId} at ${process.env.FIRESTORE_EMULATOR_HOST}.`
  );
  console.log(`Local SUPER_ADMIN document: admins/${adminEmail}`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
