export interface Candidate {
  entry_id: number; written_form: string; origin_raw: string | null; replacement: string | null;
  replacement_type: string | null; is_reliable: number | boolean; part_of_speech: string | null;
  vocabulary_level: string | null; homonym_number: number | null;
  score?: number; selection_reason?: string | null;
}
export interface Segment {
  segment_id: number; start: number; end: number; original: string; display_text: string;
  status: 'converted' | 'ambiguous' | 'no_match' | 'kept'; matched_entry_id?: number | null;
  matched_sense_id?: number | null; origin_raw?: string | null; candidates: Candidate[];
  selection_reason?: string | null; origin?: {type:string;language:string|null;raw:string;entry_id:number} | null;
}
