import {research} from '@/lib/research';
import {ENGINE_VERSION,MODEL_VERSION} from '@/lib/model';
import rules from '@/lib/financial-core/boi329.json';
import {owner} from '@/lib/storage';
export async function GET(){if(!await owner())return Response.json({error:'נדרשת כניסה'},{status:401});return Response.json({engineVersion:ENGINE_VERSION,modelVersion:MODEL_VERSION,rules,research});}
