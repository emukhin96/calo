import { redirect } from "next/navigation";
import { db } from "@/db";
import { getUserState } from "@/db/profile";
import { requireSession } from "@/lib/session";
import { Onboarding } from "./Onboarding";

/** Первый запуск: цель, о себе, рост и вес, активность. Уже пройден — в настройки. */
export default async function OnboardingPage() {
  const session = await requireSession();
  const state = await getUserState(db, session.user.id);
  if (state.profile && state.goal && state.weight) redirect("/settings");
  return <Onboarding />;
}
