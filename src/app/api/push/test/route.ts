import { apiSession } from "@/lib/api";
import { sendToUser } from "@/lib/push";

/** POST /api/push/test — проверочное уведомление на все свои устройства. */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const sent = await sendToUser(session.user.id, {
    title: "Calo",
    body: "Уведомления работают. В понедельник утром придёт разбор недели.",
    url: "/",
    tag: "test",
  });
  return Response.json({ sent });
}
