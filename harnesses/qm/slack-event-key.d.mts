export function slackEventKey(req: { kind?: string; channel?: { id?: string; [field: string]: unknown }; ts?: string; [field: string]: unknown }): string | null;
