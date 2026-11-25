import { pendingQueue, recentlyReviewed, rewardBounds, defaultReward } from "@/lib/points/submissions";
import { handle, ok, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  const [pending, reviewed] = await Promise.all([pendingQueue(200), recentlyReviewed(50)]);
  const rewards = Object.fromEntries(
    (["x_post", "simp_post", "alpha"] as const).map((k) => [k, { default: defaultReward(k), ...rewardBounds(k) }]),
  );
  return ok({ pending, reviewed, rewards });
});
