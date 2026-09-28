import { appIcon } from "@/ui/AppIcon";

// Иконка «На экран Домой» в iOS (углы iOS скругляет сама).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180);
}
