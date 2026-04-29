import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const DEVNET_RPC = 'https://api.devnet.solana.com';

export const PROGRAM_ID = new PublicKey('CVHSSRrVU6hB5sT1QFb2GpebGYRcjnZFY9L8S5guFaBf');
export const MINT       = new PublicKey('fDr7C8kMAHtQWD2jt2NGNY1is64TSZXkPRnLavoWfUj');
export const RELAY_AUTHORITY = new PublicKey('FCGAaDzk5KZxsHRpicBbYnXP4jqDyZPo16UfSFdqASWk');

export const TOKEN_PROGRAM_ID       = TOKEN_2022_PROGRAM_ID;
export const ASSOC_TOKEN_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM_ID;

export const WS_URL     = process.env.NEXT_PUBLIC_WS_URL     ?? 'ws://localhost:8080';
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:8080';

export const EXPLORER_BASE = 'https://explorer.solana.com';
