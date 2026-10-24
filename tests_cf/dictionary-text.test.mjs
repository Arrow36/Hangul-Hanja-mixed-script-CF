import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/static/dictionary-text.js';
const {render, audioUrl} = globalThis.DictionaryText;

test('render supported dictionary markup while preserving literal prose', () => {
    assert.equal(render('<i>word</i><BR/>next'), '<i>word</i><br>next');
    assert.equal(render('야간학교<Yaganhakkyo>'), '야간학교&lt;Yaganhakkyo&gt;');
    assert.equal(render('"<truyện Heungbu>"'), '&quot;&lt;truyện Heungbu&gt;&quot;');
    assert.equal(render('<i>word'), '<i>word</i>');
});
test('link only validated references, with readable fallback', () => {
    assert.match(render('→ <word_no>601450</word_no>콘텐츠_', {'601450':600228}), /data-entry-id="600228">콘텐츠<\/button>/);
    assert.equal(render('→ <word_no>601450</word_no>콘텐츠_'), '→ 콘텐츠');
    assert.equal(render('<word_no>1</word_no>word', {1:'1" onclick="alert(1)'}), 'word');
});
test('dictionary HTML and audio cannot inject scripts or event handlers', () => {
    assert.equal(render('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.match(render('<i onclick="alert(1)">x</i>'), /^&lt;i onclick=/);
    assert.equal(audioUrl('javascript:alert(1)'), null);
    assert.equal(audioUrl('data:text/html,test'), null);
    assert.equal(audioUrl('https://dicmedia.korean.go.kr/audio.wav'), 'https://dicmedia.korean.go.kr/audio.wav');
});
