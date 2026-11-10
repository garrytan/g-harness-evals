// GST-1514 Amendment 3, part 2: the secondary plan judge (GPT-6.1 Sol) as an edition-grade.ts --judge module. Settings in plan-judge.ts.
import { makeJudge, ROLES } from './plan-judge.ts';

export default makeJudge(ROLES.secondary);
