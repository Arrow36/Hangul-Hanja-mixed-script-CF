import type { KiwiToken } from './kiwi';
import type { Candidate, Segment } from './types';
import { lookup, lookupOrigins } from './dictionary';

// Port of app/services/tokenizer.py, converter.py and disambiguation.py.
const hangul = /^[가-힣]+$/u;
const cjk = /[\u3400-\u9fff\uf900-\ufaff]/u;
const noun = (t: KiwiToken) => t.tag.startsWith('NN') || t.tag === 'NR' || t.tag === 'NP';
const verb = (t: KiwiToken) => ['VV','VA','VX','VCP','VCN'].includes(t.tag);
const particle = (t: KiwiToken) => t.tag.startsWith('J') || t.tag.startsWith('E');
const punct = (t: KiwiToken) => t.tag.startsWith('S');
const content = (t: KiwiToken) => hangul.test(t.form) && (noun(t) || verb(t));
const posTags: Record<string, string[]> = {
  '명사':['NNG','NNP','NNB','NR','NP'], '동사':['VV','VX','XSV'], '형용사':['VA','VCP','VCN','XSA'],
  '부사':['MAG','MAJ'], '관형사':['MM'], '감탄사':['IC'], '대명사':['NP'], '수사':['NR'],
  '접사':['XPN','XSN','XSV','XSA'], '의존 명사':['NNB'], '보조 동사':['VX'], '보조 형용사':['VX'], '고유 명사':['NNP']
};
function scoreCandidates(candidates: Candidate[], tag: string, context: string[], collocations: Record<string,string>): Candidate[] {
  const scored = candidates.map(c => {
    let score = 0; const reasons: string[] = [];
    if (c.is_reliable && c.replacement) { score += .3; reasons.push('reliable_replacement'); }
    if (c.part_of_speech) {
      if ((posTags[c.part_of_speech] ?? []).some(t => tag.startsWith(t))) { score += .2; reasons.push('pos_match'); }
      else { score -= .1; reasons.push('pos_mismatch'); }
    }
    if (c.origin_raw) for (const word of context) {
      const expected = collocations[`${c.written_form}\0${word}`];
      if (expected && (c.origin_raw.includes(expected) || expected.includes(c.origin_raw))) {
        score += .25; reasons.push(`collocation_match(${word}->${expected})`); break;
      }
    }
    if (c.vocabulary_level === '초급') { score += .04; reasons.push('basic_vocab'); }
    else if (c.vocabulary_level === '중급') { score += .02; reasons.push('intermediate_vocab'); }
    if (c.replacement_type === 'pure_hanja') { score += .05; reasons.push('pure_hanja_type'); }
    return { ...c, score, selection_reason:reasons.join(', ') };
  }).sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
  const unique = new Map<string, Candidate>();
  for (const candidate of scored) {
    const key = `${candidate.replacement}\0${candidate.origin_raw}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}
function select(scored: Candidate[]): ['converted' | 'ambiguous' | 'no_match', Candidate | undefined] {
  const top = scored[0];
  if (!top) return ['no_match', undefined];
  const gap = (top.score ?? 0) - (scored[1]?.score ?? -Infinity);
  if (top.is_reliable && top.replacement && (top.score ?? 0) >= .5 && gap >= .15) return ['converted', top];
  if (scored.length > 1 && (top.score ?? 0) < .5) return ['ambiguous', undefined];
  return ['ambiguous', top];
}
function origin(c: Candidate | undefined): Segment['origin'] {
  if (!c?.origin_raw) return null;
  const isHanja = cjk.test(c.origin_raw);
  return { type:isHanja?'hanja':'loanword', language:isHanja?'Hanja':/[A-Za-z]/.test(c.origin_raw)?'English':null, raw:c.origin_raw, entry_id:c.entry_id };
}
function display(t: KiwiToken, selected: Candidate, original: string): string {
  const replacement = selected.replacement;
  if (!replacement) return original;
  if (verb(t) && t.form.endsWith('하') && replacement.length < original.length) return replacement + original.slice(replacement.length);
  if (selected.replacement_type === 'pure_hanja') return replacement;
  if (selected.replacement_type === 'mixed') {
    const prefix = /^[\u3400-\u9fff\uf900-\ufaff]+/u.exec(replacement)?.[0];
    return prefix && prefix.length === t.form.length ? prefix : replacement;
  }
  if (selected.replacement_type === 'slash_variants') {
    const first = replacement.split('/')[0]?.trim();
    return first && /^[\u3400-\u9fff\uf900-\ufaff]+$/u.test(first) && first.length === t.form.length ? first : original;
  }
  return original;
}
interface Group { start:number; end:number; tokens:KiwiToken[] }
function groups(text: string, tokens: KiwiToken[]): Group[] {
  const out: Group[] = []; let current: Group | undefined;
  for (const token of tokens) {
    if (!current || /\s/u.test(text.slice(current.end,token.start))) {
      if (current) out.push(current);
      current = {start:token.start,end:token.start+token.len,tokens:[token]};
    } else { current.tokens.push(token); current.end=Math.max(current.end,token.start+token.len); }
  }
  if (current) out.push(current);
  return out;
}
function forms(text:string, groups:Group[]): string[] {
  const out = new Set<string>();
  for (const group of groups) {
    for (const t of group.tokens) {
      if (content(t)) out.add(t.form);
      if (verb(t) && hangul.test(t.form)) { out.add(t.form+'다'); if (t.form.endsWith('하')) out.add(t.form.slice(0,-1)); }
      if (noun(t) && hangul.test(t.form)) { out.add(t.form+'하다'); out.add(t.form+'되다'); }
    }
    for (let i=0;i<group.tokens.length;i++) for (let j=i+2;j<=Math.min(group.tokens.length,i+8);j++) {
      const part=group.tokens.slice(i,j);
      if (part.some(t=>particle(t)||punct(t))) continue;
      out.add(text.slice(part[0].start,part.at(-1)!.start+part.at(-1)!.len));
      out.add(part.map(t=>t.form).join(''));
    }
  }
  return [...out];
}
let collocationPromise: Promise<Record<string,string>> | undefined;
function defaultCollocations(): Promise<Record<string,string>> {
  return collocationPromise ??= fetch('/static/collocations.json').then(r => r.ok ? r.json() as Promise<Record<string,string>> : {});
}
export async function convert(text: string, tokens: KiwiToken[], lookupFn: typeof lookup = lookup, collocations?: Record<string,string>, originFn: typeof lookupOrigins = lookupOrigins): Promise<Segment[]> {
  if (!text) return [];
  const allGroups = groups(text,tokens);
  const candidates = await lookupFn(forms(text,allGroups));
  collocations ??= await defaultCollocations();
  const boundaries = [...text.matchAll(/[.!?。！？\r\n]+/gu)].map(m => m.index + m[0].length);
  const bySentence = new Map<number, KiwiToken[]>();
  for (const token of tokens) if (content(token)) {
    const sentence = boundaries.filter(b => b <= token.start).length;
    const list = bySentence.get(sentence) ?? []; list.push(token); bySentence.set(sentence,list);
  }
  const contextAt = new Map<number,string[]>();
  for (const sentence of bySentence.values()) sentence.forEach((token,index) => {
    contextAt.set(token.start,[...new Set(sentence.slice(Math.max(0,index-8),index+9).filter(t=>t!==token).map(t=>t.form))]);
  });
  const segments: Segment[] = [];
  function add(start:number,end:number,status:Segment['status'],replacement?:string,scored:Candidate[]=[],selected?:Candidate,reason?:string) {
    if (end<=start) return;
    segments.push({ segment_id:segments.length,start,end,original:text.slice(start,end),display_text:replacement??text.slice(start,end),
      status,matched_entry_id:selected?.entry_id??null,origin_raw:selected?.origin_raw??null,candidates:scored,selection_reason:reason??null,origin:origin(selected) });
  }
  let position=0;
  for (const group of allGroups) {
    if (group.start>position) add(position,group.start,'kept',undefined,[],undefined,'whitespace_or_empty');
    position=group.start;
    for (let i=0;i<group.tokens.length;) {
      const token=group.tokens[i];
      if (token.start+token.len<=position) { i++; continue; }
      if (token.start>position) add(position,token.start,'kept',undefined,[],undefined,'inter_token_gap');
      position=Math.max(position,token.start);
      let matched=false;
      for (let j=Math.min(group.tokens.length,i+8);j>i+1;j--) {
        const part=group.tokens.slice(i,j);
        if (part.some(t=>particle(t)||punct(t))) continue;
        const end=part.at(-1)!.start+part.at(-1)!.len;
        const word=text.slice(part[0].start,end);
        const choices=candidates[word]?.length?candidates[word]:candidates[part.map(t=>t.form).join('')];
        if (!choices?.length) continue;
        const context=(contextAt.get(token.start) ?? []).filter(f=>f!==word && f!==part.map(t=>t.form).join(''));
        const scored=scoreCandidates(choices,token.tag,context,collocations);
        const [status,selected]=select(scored);
        if (status==='converted' && selected?.replacement) {
          add(position,end,'converted',selected.replacement,scored,selected,'whole_word_match');
          position=end;i=j;matched=true;break;
        }
      }
      if (matched) continue;
      const end=Math.max(position,token.start+token.len);
      if (content(token)) {
        const verbal=group.tokens[i+1] && group.tokens[i+1].tag.startsWith('XS') && ['하','되','시키'].includes(group.tokens[i+1].form);
        let choices=candidates[token.form]??[];
        if (!choices.length && verb(token)) choices=candidates[token.form+'다']??[];
        if (!choices.length && verbal) choices=candidates[token.form+'하다']??[];
        const scored=scoreCandidates(choices,token.tag,(contextAt.get(token.start) ?? []).filter(f=>f!==token.form),collocations);
        const [status,selected]=select(scored);
        add(position,end,status,status==='converted'&&selected?display(token,selected,text.slice(position,end)):undefined,scored,selected,choices.length?'insufficient_evidence':undefined);
      } else add(position,end,'kept',undefined,[],undefined,particle(token)?'particle':token.tag.startsWith('XS')?'stem_suffix':'non_content_token');
      position=end;i++;
    }
    if (position<group.end) {add(position,group.end,'kept',undefined,[],undefined,'trailing_text');position=group.end;}
  }
  if (position<text.length) add(position,text.length,'kept',undefined,[],undefined,'trailing_fill');
  const excluded = new Set(['non_content_token','whitespace_or_empty','particle','stem_suffix','inter_token_gap','trailing_text']);
  const unresolved = segments.filter(s=>!s.origin && s.original.trim() && !excluded.has(s.selection_reason??''));
  if (unresolved.length) {
    const origins = await originFn(unresolved.map(s=>s.original));
    for (const segment of unresolved) {
      const rows = origins[segment.original]??[];
      if (!rows.length) continue;
      const values=[...new Set(rows.map(r=>r.origin_raw).filter((v):v is string=>!!v))];
      const raw=values.length?values.join(' / '):'고유어';
      const type=values.length?(cjk.test(raw)?'hanja':'loanword'):'native';
      segment.origin={type,language:type==='hanja'?'Hanja':type==='native'?'Korean':/[A-Za-z]/.test(raw)?'English':null,raw,entry_id:rows[0].entry_id};
    }
  }
  return segments;
}
