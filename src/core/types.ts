// Datamodellen spejler content-pipelinens kolonner (PRD §5) — indhold er
// altid data, aldrig kode.

export interface Element {
  id: string;
  navn: string;
  ikon: string;
  akt: number;
  start: boolean;
}

export interface Combo {
  element_a: string;
  element_b: string;
  resultat: string;
  flavor: string;
  historisk_note: string;
  kilde_url: string;
  narrator_replik: string | null;
  flags_sat: string[];
  flags_kraevet: string[];
  loeser_problem: string | null;
  akt: number;
  age_up: boolean;
}

export interface Problem {
  id: string;
  titel: string;
  obligatorisk: boolean;
}

export interface Act {
  akt: number;
  navn: string;
  problemer: Problem[];
  age_up: {
    resultat: string;
    naeste_akt: number;
    banner: string;
  };
}

export type Flags = Record<string, boolean>;
