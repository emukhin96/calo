import { requireSession } from "@/lib/session";
import { RecipeEditor } from "../RecipeEditor";

export default async function NewRecipePage({ searchParams }: PageProps<"/recipes/new">) {
  await requireSession();
  const { kind } = await searchParams;
  return <RecipeEditor kind={kind === "template" ? "template" : "composite"} />;
}
