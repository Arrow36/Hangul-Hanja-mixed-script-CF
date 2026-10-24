// Interpret only known dictionary markup. Literal angle-bracketed prose and
// unknown elements remain escaped text; dictionary data never becomes raw HTML.
(() => {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
    function render(value, references = {}) {
        const text = String(value ?? '').replace(/&(quot|apos|amp);/g, (_, entity) => ({quot: '"', apos: "'", amp: '&'})[entity]);
        const tokens = /<word_no>(\d+)<\/word_no>([^\s<>]*)|<i>|<\/i>|<br\s*\/?>/gi;
        let html = '', position = 0, italics = 0;
        for (const match of text.matchAll(tokens)) {
            html += escape(text.slice(position, match.index));
            if (match[1]) {
                const label = match[2].replace(/_+$/, '') || match[1];
                const id = references[match[1]];
                html += Number.isSafeInteger(id) && id > 0
                    ? `<button type="button" class="dictionary-reference" data-entry-id="${id}">${escape(label)}</button>`
                    : escape(label);
            } else if (/^<br/i.test(match[0])) html += '<br>';
            else if (match[0].toLowerCase() === '<i>') { html += '<i>'; italics++; }
            else if (italics) { html += '</i>'; italics--; }
            else html += escape(match[0]);
            position = match.index + match[0].length;
        }
        return html + escape(text.slice(position)) + '</i>'.repeat(italics);
    }
    function audioUrl(value) {
        try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
        } catch { return null; }
    }
    globalThis.DictionaryText = {render, escape, audioUrl};
})();
