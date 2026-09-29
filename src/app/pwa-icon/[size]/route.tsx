import { appIcon } from "@/ui/AppIcon";

// /pwa-icon/192, /512, /512-maskable — для манифеста; /1024 — иконка iOS-приложения.
const SIZES = { "192": 192, "512": 512, "512-maskable": 512, "1024": 1024 } as const;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await ctx.params;
  if (!(size in SIZES)) return new Response("Not found", { status: 404 });
  return appIcon(SIZES[size as keyof typeof SIZES], { maskable: size.endsWith("maskable") });
}
