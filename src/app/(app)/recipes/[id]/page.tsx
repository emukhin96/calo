import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { getRecipe } from "@/db/recipes";
import { requireSession } from "@/lib/session";
import { RecipeEditor } from "../RecipeEditor";

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const session = await requireSession();
  const { id } = await params;
  const recipe = z.uuid().safeParse(id).success ? await getRecipe(db, session.user.id, id) : null;
  if (!recipe) notFound();
  return <RecipeEditor recipe={recipe} kind={recipe.kind} />;
}
