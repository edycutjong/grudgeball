/**
 * Daily post creation (Reddit API adapter — kept out of pure core).
 */
import { reddit } from '@devvit/web/server';
import { dayNumber } from '../../shared/day';

export const DAILY_TITLE_PREFIX = 'Grudgeball — Day';

export function dailyPostTitle(day: string): string {
  return `${DAILY_TITLE_PREFIX} ${dayNumber(day)} · ${day} · drop, die, plant your revenge`;
}

export async function createDailyPost(day: string) {
  return await reddit.submitCustomPost({
    title: dailyPostTitle(day),
    textFallback: {
      text: 'Grudgeball is an interactive daily gauntlet. Open this post in the Reddit app or new reddit.com to play.',
    },
  });
}
