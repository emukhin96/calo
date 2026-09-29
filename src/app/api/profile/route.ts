import { db } from "@/db";
import { addWeight, getUserState, saveProfile, setGoal } from "@/db/profile";
import { apiSession } from "@/lib/api";
import { loadUser } from "@/lib/norms";
import { ProfileBody } from "@/lib/profile-schema";

/** PUT /api/profile — онбординг и настройки: профиль, цель и (необязательно) текущий вес. */
export async function PUT(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = ProfileBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request", issues: body.error.issues }, { status: 400 });

  const owner = session.user.id;
  const { goal, weightKg, ...profile } = body.data;
  const before = await getUserState(db, owner);
  if (weightKg == null && !before.weight) return Response.json({ error: "weight required" }, { status: 400 });

  await saveProfile(db, owner, profile);
  await setGoal(db, owner, goal);
  if (weightKg != null && weightKg !== before.weight?.kg) await addWeight(db, owner, weightKg);
  return Response.json(await loadUser(owner));
}
