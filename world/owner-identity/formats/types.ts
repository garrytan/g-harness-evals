// Shapes the owner-identity export writers take. `who` is the true speaker (a person id or agent:<label>) and never reaches
// the rendered file; `label` is what the export shows for that speaker.

export interface Line {
  who: string;
  label: string;
  at: number;
  text: string;
  forwardedFrom?: string;
}

export interface AgentTurn {
  who: string;
  role: 'user' | 'assistant';
  at: number;
  text: string;
  sidechain?: boolean;
}

export interface Email {
  who: string;
  fromName: string;
  fromAddr: string;
  to: string[];
  cc?: string[];
  at: number;
  subject: string;
  body: string;
  labels: string[];
  id: string;
  sender?: string;
}

export interface Rendered {
  name: string;
  format: string;
  known: boolean;
  text: string;
}
