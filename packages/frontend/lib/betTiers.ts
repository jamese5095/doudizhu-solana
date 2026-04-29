export interface BetTierConfig {
  tier:   number;
  name:   string;
  amount: bigint;
  desc:   string;
}

export const BET_TIERS: BetTierConfig[] = [
  { tier: 0, name: '练习场', amount: 100n,   desc: '新手友好' },
  { tier: 1, name: '竞技场', amount: 500n,   desc: '标准对局' },
  { tier: 2, name: '赌场',   amount: 2000n,  desc: '高手专区' },
  { tier: 3, name: '鲸鱼池', amount: 10000n, desc: '顶级战场' },
];
