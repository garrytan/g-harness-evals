// GST-1514 Amendment 3, part 2: the primary plan judge (Opus 5.5) as an edition-grade.ts --judge module. Settings in plan-judge.ts.
import { makeJudge, ROLES } from './plan-judge.ts';

export default makeJudge(ROLES.primary);
