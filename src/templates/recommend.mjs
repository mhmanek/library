// "Post me a book": a postcard posted into a brass returns slot. The visitor writes on the message side
// (their note in handwriting as they type); the picture side becomes the cover of the book they pick.
// With the Worker configured the card is posted to it; without one the same card goes out by email.
// No-JS visitors get a plain postcard with a mailto button.
import {html} from './html.mjs';
import {icon} from './icons.mjs';
import {sectionHead} from './section.mjs';
import {picture, stamp, postmark, address} from './postcard.mjs';
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

function composer(live) {
  return html`<form class="pc pc--compose" id="rec-form" novalidate data-rec data-mode="${live ? 'post' : 'mail'}" aria-labelledby="rec-head">
<h3 class="sr-only" id="rec-head">${R.cardHead}</h3>
<div class="errsum" tabindex="-1" hidden data-errsum role="alert"></div>
<div class="pc-flip">
<div class="pc-side pc-back" data-back>
<p class="pc-print" aria-hidden="true">${R.print}</p>
<span class="pc-corner" data-stamp>${stamp()}${postmark()}</span>
<div class="pc-msg">
${field({id: 'rec-title', label: R.book, hint: R.bookHint, input: html`<div class="combo"><input id="rec-title" name="title" type="text" required maxlength="200" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rec-list" aria-describedby="rec-title-hint"><ul class="lb" id="rec-list" role="listbox" aria-label="Suggestions from Open Library" hidden></ul></div><p class="chosen" hidden data-chosen><span></span><button type="button" class="linkish" data-unchoose aria-label="Clear the Open Library selection">${icon('x')}</button></p><p class="onshelf" hidden data-onshelf></p>`})}
${field({id: 'rec-author', label: R.author, input: html`<input id="rec-author" name="author" type="text" maxlength="120" autocomplete="off">`})}
${field({id: 'rec-note', label: R.note, input: html`<textarea id="rec-note" name="note" maxlength="280" rows="4" placeholder="${R.notePh}" aria-describedby="rec-note-count"></textarea><p class="count-n" id="rec-note-count"><span data-count-n>0</span> / 280</p>`})}
${field({id: 'rec-name', label: R.name, hint: R.nameHint, input: html`<input id="rec-name" name="name" type="text" maxlength="40" autocomplete="name" aria-describedby="rec-name-hint" placeholder="${R.namePh}">`})}
</div>
<div class="pc-addr">
${address()}
${live ? field({id: 'rec-email', label: R.email, hint: R.emailHint, input: html`<input id="rec-email" name="email" type="email" maxlength="120" autocomplete="email" aria-describedby="rec-email-hint">`}) : ''}
</div>
</div>
<div class="pc-side pc-front" aria-hidden="true" inert data-front>
<span class="pc-pic-wrap" data-pic>${picture()}</span>
<p class="pc-cap"><span class="pc-cap-t" data-cap>${R.front}</span></p>
</div>
</div>
<div class="hp" aria-hidden="true"><label>Leave empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
<p class="sr-only" role="status" aria-live="polite" data-lb-status></p>
<div class="pc-under">
<button type="button" class="btn btn--ghost btn--sm" data-turn data-unturn="${R.unturn}" aria-pressed="false">${icon('turn')}<span>${R.turn}</span></button>
${live ? html`<div class="ts" id="rec-ts"></div>` : ''}
<div class="rec-act"><button class="btn" type="submit" data-submit><span>${live ? R.submit : R.submitMail}</span>${icon('arrow')}</button><p class="small">${live ? R.small : R.smallMail}</p></div>
<p class="rec-msg" hidden data-msg tabindex="-1"></p>
</div>
</form>
<div class="thanks" hidden data-thanks tabindex="-1"><p class="stamped" aria-hidden="true" data-stamp-text></p><p data-thanks-text></p><button class="btn btn--ghost" type="button" data-again>Write another</button></div>`;
}

export function recommendSection({num, config}) {
  const email = config.site.email;
  const live = Boolean(config.visitorShelf?.workerUrl && config.visitorShelf?.turnstileSiteKey);
  return html`<section id="recommend" class="sec sec--rec" aria-labelledby="h-recommend">
${sectionHead({id: 'recommend', num, tab: COPY.recommend.tab})}
<p class="display">${R.display}</p>
<p class="dek">${R.dek}</p>
<div class="returns">
<div class="js-only rec-wrap">${composer(live)}</div>
<div class="postcard no-js-only">
<p class="icard-h">${R.print}</p>
<p>${R.postcard}</p>
<p><a class="btn" href="${mailto(email)}"><span>${R.postcardCta}</span>${icon('arrow')}</a></p>
</div>
<div class="slot" aria-hidden="true"><span class="slot-slit"></span><span class="slot-txt">${R.plate}</span></div>
</div>
<p class="prefer">${R.prefer} <a href="${mailto(email)}" data-mailto>${email}</a></p>
</section>`;
}
