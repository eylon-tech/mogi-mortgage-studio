import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export async function owner(){const u=await getChatGPTUser();return u?.userId??null;}
export function db(){const d=(env as unknown as {DB?:D1Database}).DB;if(!d)throw Error('אחסון אינו זמין כרגע');return d;}
export const failure=()=>Response.json({error:'לא הצלחנו לגשת לאחסון. הנתונים שהזנת נשארו במסך; אפשר לנסות שוב.'},{status:503});
export function sameOrigin(r:Request){const origin=r.headers.get('origin');return !origin||origin===new URL(r.url).origin;}
