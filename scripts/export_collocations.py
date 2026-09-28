"""Export the original dictionary's collocation evidence for browser disambiguation."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.dictionary import DictionaryService

async def main():
    root = Path(__file__).resolve().parent.parent
    dictionary = DictionaryService(str(root / 'hanja_dict.db'))
    collocations = await dictionary.load_collocations()
    data = {f'{word}\0{context}': origin for (word, context), origin in collocations.items()}
    target = root / 'public/static/collocations.json'
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
    print(f'Exported {len(data)} collocations to {target}')

if __name__ == '__main__': asyncio.run(main())
