// "Leave a book in the returns slot": a paper index card posted into a brass slot. The form is rendered
// only when both the Worker URL and the Turnstile site key are configured; otherwise (and always, below
// the card) a mailto postcard does the job.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {sectionHead} from './shelf.mjs';
import {COPY} from '../content/copy.mjs';

const R = COPY.recommend;

export const mailto = (email, {title = '', author = '', note = '', name = ''} = {}) => {
  const subject = title ? `Book recommendation: ${title}` : 'Book recommendation';
  const body = title ? `${title}${author ? ` by ${author}` : ''}\n\n${note}${name ? `\n\n— ${name}` : ''}` : '';
  return `mailto:${email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
};

function field({id, label, hint = '', input}) {
  return html`<div class="fld" data-fld="${id}"><label for="${id}">${label}</label>${input}${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}<p class="ferr" id="${id}-err" hidden></p></div>`;
}

function form(email) {
  return html`<form class="icard" id="rec-form" novalidate data-rec aria-labelledby="rec-head">
<p class="icard-h" id="rec-head">${R.cardHead}</p>
<div class="errsum" tabindex="-1" hidden data-errsum role="alert"></div>
${field({id: 'rec-title', label: R.book, hint: R.bookHint, input: html`<div class="combo"><input id="rec-title" name="title" type="text" required maxlength="200" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rec-list" aria-describedby="rec-title-hint"><ul class="lb" id="rec-list" role="listbox" aria-label="Suggestions from Open Library" hidden></ul></div><p class="chosen" hidden data-chosen><span></span><button type="button" class="linkish" data-unchoose aria-label="Clear the Open Library selection">${icon('x')}</button></p><p class="onshelf" hidden data-onshelf></p>`})}
${field({id: 'rec-author', label: R.author, input: html`<input id="rec-author" name="author" type="text" maxlength="120" autocomplete="off">`})}
${field({id: 'rec-note', label: R.note, input: html`<textarea id="rec-note" name="note" maxlength="280" rows="3" aria-describedby="rec-note-count"></textarea><p class="count-n" id="rec-note-count"><span data-count-n>0</span> / 280</p>`})}
<div class="fld-row">
${field({id: 'rec-name', label: R.name, hint: R.nameHint, input: html`<input id="rec-name" name="name" type="text" maxlength="40" autocomplete="name" aria-describedby="rec-name-hint" placeholder="a visitor">`})}
${field({id: 'rec-email', label: R.email, hint: R.emailHint, input: html`<input id="rec-email" name="email" type="email" maxlength="120" autocomplete="email" aria-describedby="rec-email-hint">`})}
</div>
<div class="hp" aria-hidden="true"><label>Leave empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
<p class="sr-only" role="status" aria-live="polite" data-lb-status></p>
<div class="ts" id="rec-ts"></div>
<div class="rec-act"><button class="btn" type="submit" data-submit><span>${R.submit}</span>${icon('arrow')}</button><p class="small">${R.small}</p></div>
<p class="rec-msg" hidden data-msg tabindex="-1"></p>
</form>
<div class="thanks" hidden data-thanks tabindex="-1"><p class="stamped" aria-hidden="true" data-stamp></p><p data-thanks-text></p><button class="btn btn--ghost" type="button" data-again>Recommend another</button></div>`;
}

export function recommendSection({num, config}) {
  const email = config.site.email;
  const live = Boolean(config.visitorShelf?.workerUrl && config.visitorShelf?.turnstileSiteKey);
  return html`<section id="recommend" class="sec sec--rec" aria-labelledby="h-recommend">
${sectionHead({id: 'recommend', num, tab: COPY.recommend.tab})}
<p class="display">${R.display}</p>
<p class="dek">${R.dek}</p>
<div class="returns${live ? ' is-live' : ''}">
${live ? html`<div class="js-only rec-wrap">${form(email)}</div>` : ''}
<div class="postcard${live ? ' no-js-only' : ''}">
<p class="icard-h">Postcard</p>
<p>${R.postcard}</p>
<p><a class="btn" href="${mailto(email)}"><span>${R.postcardCta}</span>${icon('arrow')}</a></p>
</div>
<div class="slot" aria-hidden="true"><span class="slot-slit"></span><span class="slot-txt">${R.plate}</span></div>
</div>
<p class="prefer">${R.prefer} <a href="${mailto(email)}" data-mailto>${email}</a></p>
</section>`;
}
