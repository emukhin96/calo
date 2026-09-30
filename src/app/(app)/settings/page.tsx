import { redirect } from "next/navigation";
import { db } from "@/db";
import { weightHistory } from "@/db/profile";
import { loadUser } from "@/lib/norms";
import { requireSession } from "@/lib/session";
import { Settings } from "./Settings";

export default async function SettingsPage() {
  const session = await requireSession();
  const { state, norms, mealItems, showMealTimes } = await loadUser(session.user.id);
  if (!state.profile || !state.goal || !state.weight || !norms) redirect("/onboarding");
  const weights = await weightHistory(db, session.user.id);
  return (
    <Settings
      email={session.user.email}
      profile={state.profile}
      goal={state.goal}
      weights={weights.map((w) => ({ id: w.id, kg: w.kg, at: w.measuredAt.toISOString() }))}
      norms={norms}
      overrides={state.overrides}
      mealItems={mealItems}
      showMealTimes={showMealTimes}
    />
  );
}
