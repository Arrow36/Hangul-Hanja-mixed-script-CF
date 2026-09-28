"""Capture original Python outputs and candidate data for CF parity tests.

Requires the original SQLite database and requirements.txt dependencies.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.tokenizer import TokenizerService
from app.services.dictionary import DictionaryService
from app.services.disambiguation import DisambiguationService
from app.services.converter import ConverterService

SAMPLES = [
    '한국 경제가 빠르게 성장했다.', '대한민국의 경제는 발전하고 있다.',
    '사회와 문화가 변화한다.', '학교에서 학생이 공부한다.',
    '국제 관계를 연구한다.', '정치와 경제를 논의했다.',
    '서울은 한국의 수도이다.', '부산에서 기차를 탔다.',
    '사과를 먹었다.', '배를 탔다.', '눈이 내린다.', '은행에 갔다.',
    '발전하는 도시', '변화된 사회', '공부하고 있다.', '아름다운 꽃이 피었다.',
    '빠르게 달리는 사람', '새로운 기술을 개발한다.', '그는 책을 읽었다.',
    '그녀가 음악을 들었다.', '나는 집에 간다.', '우리는 영화를 본다.',
    '한국의 역사와 전통', '경제 성장과 사회 발전',
    '안녕하세요!', '무슨 일입니까?', '오늘은 날씨가 좋다.',
    '2026년 9월 19일', '가격은 1000원이다.', 'AI 기술과 한국어',
    'Python과 JavaScript를 사용한다.', '漢字와 한글을 함께 쓴다.',
    '이 문장에는 변환할 단어가 없다.', '가나다라마바사',
    '하나, 둘, 셋.', '정말 감사합니다.', '정보와 통신 기술',
    '문화적 차이를 이해한다.', '국제화 시대', '현대 한국 사회의 변화.',
    '대한민국 헌법을 읽는다.', '한글과 漢字 mixed text.',
]

async def main():
    root = Path(__file__).resolve().parent.parent
    tokenizer = TokenizerService()
    dictionary = DictionaryService(str(root / 'hanja_dict.db'))
    disambiguation = DisambiguationService(await dictionary.load_collocations())
    converter = ConverterService(tokenizer, disambiguation)
    output = []
    for text in SAMPLES:
        tokens = tokenizer.tokenize(text)
        looked_up = {}
        async def capture(words):
            results = await dictionary.batch_lookup_candidates(words)
            looked_up.update(results)
            return results
        segments, _ = await converter.convert(text, capture)
        output.append({
            'text': text,
            'tokens': [{'form':t.form,'tag':t.tag,'start':t.start,'len':t.length} for t in tokens],
            'candidates': looked_up,
            'python_display': ''.join(s.display_text for s in segments),
            'python_segments': [{'original':s.original,'display_text':s.display_text,'status':s.status} for s in segments],
        })
    folder = root / 'tests_cf'
    folder.mkdir(exist_ok=True)
    (folder / 'regression.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Saved {len(output)} Python regression cases')

if __name__ == '__main__': asyncio.run(main())
